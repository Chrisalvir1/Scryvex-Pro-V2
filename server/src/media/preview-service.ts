import { randomUUID } from 'crypto';
import { ResolvedMediaInput } from './media-resolvers';
import { MediaSourceSessionManager } from './media-session-manager';
import { MediaSourceSelector } from './media-selector';
import { CameraProviderRegistry } from '../cameras/camera-provider-registry';
import { ProbedMediaSource, MediaOperationError } from './media-source';
import { IMediaProcessRunner, DefaultMediaProcessRunner } from './media-process-runner';
import { ChildProcess } from 'child_process';

export class PreviewService {
    private activeSessions = new Map<string, ChildProcess>();

    constructor(
        private sessionManager: MediaSourceSessionManager,
        private selector: MediaSourceSelector,
        private providerRegistry: CameraProviderRegistry,
        private runner: IMediaProcessRunner = new DefaultMediaProcessRunner()
    ) {}

    private async resolveProfile(deviceId: string, signal?: AbortSignal): Promise<ProbedMediaSource> {
        // We simulate probing/selecting. Ideally we get probed sources.
        const provider = this.providerRegistry.getProviderForProtocol('RTSP'); // Assuming RTSP for now, ideally pass protocol or lookup
        const discovery = await provider.getMediaSources(deviceId, signal);
        
        if (!discovery.available || discovery.sources.length === 0) {
            throw new MediaOperationError('No media sources available', 'not_retryable');
        }

        const probedSources: ProbedMediaSource[] = discovery.sources.map(s => ({
            descriptor: s,
            profile: { id: s.id },
            probeSucceeded: true
        }));

        const selectedProfile = this.selector.selectForPreview(probedSources);
        if (!selectedProfile) throw new MediaOperationError('No suitable profile found', 'not_retryable');
        
        const source = probedSources.find(ps => ps.profile.id === selectedProfile.id);
        if (!source) throw new MediaOperationError('Selected profile source not found', 'not_retryable');
        
        return source;
    }

    async getFrame(deviceId: string, signal?: AbortSignal): Promise<Buffer> {
        const source = await this.resolveProfile(deviceId, signal);
        const sourceId = source.descriptor.id;
        const pluginId = source.descriptor.pluginId;

        return this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            const args = [
                '-hide_banner', '-loglevel', 'error',
                ...input.ffmpegInputArguments,
                '-frames:v', '1',
                '-f', 'image2',
                '-vcodec', 'mjpeg',
                'pipe:1'
            ];

            const result = await this.runner.run({
                command: 'ffmpeg',
                args,
                signal: sig,
                inputStream: input.inputStream,
                inputBuffer: input.inputBuffer
            });

            if (result.exitCode === 0) {
                const buf = result.stdout;
                if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length-2] === 0xff && buf[buf.length-1] === 0xd9) {
                    return buf;
                } else {
                    throw new MediaOperationError('Invalid JPEG returned from FFmpeg', 'unknown');
                }
            } else {
                throw new MediaOperationError(`FFmpeg exited with code ${result.exitCode}: ${result.stderr}`, 'unknown');
            }
        }, pluginId, signal);
    }

    async startMjpeg(deviceId: string, res: import('express').Response, signal?: AbortSignal): Promise<void> {
        const source = await this.resolveProfile(deviceId, signal);
        const sourceId = source.descriptor.id;
        const pluginId = source.descriptor.pluginId;

        const correlationId = randomUUID();

        await this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            return new Promise<void>((resolve, reject) => {
                const boundary = 'scryvexframe';
                res.writeHead(200, {
                    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
                    'Cache-Control': 'no-store, no-cache',
                    'Connection': 'close',
                    'Pragma': 'no-cache'
                });

                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    ...input.ffmpegInputArguments,
                    '-f', 'mpjpeg',
                    '-vcodec', 'mjpeg',
                    '-boundary_tag', boundary,
                    'pipe:1'
                ];

                const { process: ff, promise } = this.runner.spawnStreaming({
                    command: 'ffmpeg',
                    args,
                    signal: sig,
                    inputStream: input.inputStream,
                    inputBuffer: input.inputBuffer,
                    onStdout: (chunk) => res.write(chunk),
                    onStderr: (chunk) => {
                        // could log stderr
                    }
                });

                this.activeSessions.set(correlationId, ff);

                const cleanup = () => {
                    if (!ff.killed) ff.kill('SIGTERM');
                    this.activeSessions.delete(correlationId);
                };

                res.on('close', cleanup);
                
                promise.then(result => {
                    cleanup();
                    if (!res.writableEnded) res.end();
                    resolve();
                }).catch(err => {
                    console.error(`[PreviewService] MJPEG error [${correlationId}]:`, err);
                    cleanup();
                    reject(err);
                });

                if (sig) {
                    sig.addEventListener('abort', cleanup);
                }
            });
        }, pluginId, signal);
    }
    
    stopSession(sessionId: string) {
        const ff = this.activeSessions.get(sessionId);
        if (ff && !ff.killed) ff.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
    }
}
