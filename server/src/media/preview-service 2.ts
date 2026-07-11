import { randomUUID } from 'crypto';
import { ResolvedMediaInput, MediaInputResolverRegistry } from './media-resolvers';
import { MediaSourceSessionManager } from './media-session-manager';
import { MediaSourceSelector } from './media-selector';
import { CameraProviderRegistry } from '../cameras/camera-provider-registry';
import { ProbedMediaSource, MediaOperationError } from './media-source';
import { IMediaProcessRunner, DefaultMediaProcessRunner } from './media-process-runner';
import { MediaProbeService } from './media-probe';
import { ConnectionSecretStore } from './credential-store';
import { ChildProcess } from 'child_process';
import { classifyMediaError } from '../cameras/camera-adapter';

export class PreviewService {
    private activeSessions = new Map<string, ChildProcess>();

    constructor(
        private sessionManager: MediaSourceSessionManager,
        private selector: MediaSourceSelector,
        private providerRegistry: CameraProviderRegistry,
        private mediaProbe: MediaProbeService,
        private resolverRegistry: MediaInputResolverRegistry,
        private secretStore: ConnectionSecretStore,
        private runner: IMediaProcessRunner = new DefaultMediaProcessRunner()
    ) {}

    /**
     * B4: Resolves real ProbedMediaSource from CameraProbe DB data, or runs an
     * inline probe if no validated profiles exist yet.  No fake { id } profiles.
     */
    private async resolveProfile(
        deviceId: string,
        cameraProbe: import('../api/camera-probe').CameraProbe,
        signal?: AbortSignal
    ): Promise<ProbedMediaSource> {
        // 1. Try to get cached probed sources from DB
        let probedSources = await cameraProbe.getProbedSources(deviceId);

        // 2. If none found, run a probe inline
        if (!probedSources || probedSources.length === 0) {
            await cameraProbe.runProbe(deviceId);
            probedSources = await cameraProbe.getProbedSources(deviceId);
        }

        if (!probedSources || probedSources.length === 0) {
            throw new MediaOperationError(
                `No hay perfiles validados para la cámara ${deviceId}`,
                'not_retryable'
            );
        }

        const selectedProfile = this.selector.selectForPreview(probedSources);
        if (!selectedProfile) {
            throw new MediaOperationError('No se encontró un perfil adecuado para preview', 'not_retryable');
        }

        const source = probedSources.find(ps => ps.profile.id === selectedProfile.id);
        if (!source) {
            throw new MediaOperationError('El perfil seleccionado no tiene descriptor asociado', 'not_retryable');
        }

        return source;
    }

    async getFrame(
        deviceId: string,
        cameraProbe: import('../api/camera-probe').CameraProbe,
        signal?: AbortSignal
    ): Promise<Buffer> {
        const source = await this.resolveProfile(deviceId, cameraProbe, signal);
        const { id: sourceId, pluginId } = source.descriptor;

        return this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            const args = [
                '-hide_banner', '-loglevel', 'error',
                ...input.ffmpegInputArguments,
                '-frames:v', '1',
                '-f', 'image2',
                '-vcodec', 'mjpeg',
                'pipe:1',
            ];

            const result = await this.runner.run({
                command: 'ffmpeg',
                args,
                signal: sig,
                timeoutMs: 15_000,
                inputStream: input.inputStream,
                inputBuffer: input.inputBuffer,
            });

            if (result.exitCode === 0) {
                const buf = result.stdout;
                if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) {
                    return buf;
                }
                throw new MediaOperationError('FFmpeg no devolvió un JPEG válido', 'unknown');
            }

            const errorCategory = classifyMediaError(result.stderr, result.exitCode);
            throw new MediaOperationError(
                `FFmpeg falló (exit ${result.exitCode}): ${result.stderr.slice(0, 256)}`,
                errorCategory
            );
        }, pluginId, signal);
    }

    async startMjpeg(
        deviceId: string,
        res: import('express').Response,
        cameraProbe: import('../api/camera-probe').CameraProbe,
        signal?: AbortSignal
    ): Promise<void> {
        const source = await this.resolveProfile(deviceId, cameraProbe, signal);
        const { id: sourceId, pluginId } = source.descriptor;
        const correlationId = randomUUID();

        await this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            return new Promise<void>((resolve, reject) => {
                const boundary = 'scryvexframe';
                res.writeHead(200, {
                    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
                    'Cache-Control': 'no-store, no-cache',
                    'Connection': 'close',
                    'Pragma': 'no-cache',
                });

                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    ...input.ffmpegInputArguments,
                    '-f', 'mpjpeg',
                    '-vcodec', 'mjpeg',
                    '-boundary_tag', boundary,
                    'pipe:1',
                ];

                const { process: ff, promise } = this.runner.spawnStreaming({
                    command: 'ffmpeg',
                    args,
                    signal: sig,
                    inputStream: input.inputStream,
                    inputBuffer: input.inputBuffer,
                    outputStream: res, // Delegar a Node para manejar backpressure
                });

                this.activeSessions.set(correlationId, ff);

                const cleanup = () => {
                    if (!ff.killed) ff.kill('SIGTERM');
                    this.activeSessions.delete(correlationId);
                };

                res.on('close', cleanup);
                sig?.addEventListener('abort', cleanup, { once: true });

                promise.then(() => {
                    cleanup();
                    if (!res.writableEnded) res.end();
                    resolve();
                }).catch(err => {
                    console.error(`[PreviewService] MJPEG error [${correlationId}]:`, err);
                    cleanup();
                    reject(err);
                });
            });
        }, pluginId, signal);
    }

    stopSession(sessionId: string) {
        const ff = this.activeSessions.get(sessionId);
        if (ff && !ff.killed) ff.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
    }
}
