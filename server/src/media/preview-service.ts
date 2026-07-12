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
        cameraService: import('../api/camera-service').CameraService,
        signal?: AbortSignal
    ): Promise<Buffer> {
        const source = await this.resolveProfile(deviceId, cameraProbe, signal);
        const { id: sourceId, pluginId } = source.descriptor;
        
        await cameraService.recordLog(deviceId, 'camera.preview.source_resolved', { sourceId, pluginId });

        return this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            await cameraService.recordLog(deviceId, 'camera.preview.ffprobe.started', { args: input.ffmpegInputArguments });
            const args = [
                '-hide_banner', '-loglevel', 'error',
                ...input.ffmpegInputArguments,
                '-map', '0:v:0',
                '-an',
                '-frames:v', '1',
                '-vf', 'scale=1280:-2',
                '-c:v', 'mjpeg',
                '-q:v', '5',
                '-f', 'image2',
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
                const err = new MediaOperationError('FFmpeg no devolvió un JPEG válido', 'unknown');
                await cameraService.recordLog(deviceId, 'camera.preview.frame.failed', { reason: err.message });
                throw err;
            }

            const errorCategory = classifyMediaError(result.stderr, result.exitCode);
            const errMsg = `FFmpeg falló (exit ${result.exitCode}): ${result.stderr.slice(0, 256)}`;
            await cameraService.recordLog(deviceId, 'camera.preview.ffprobe.failed', { exitCode: result.exitCode, category: errorCategory, error: errMsg });
            throw new MediaOperationError(errMsg, errorCategory);
        }, pluginId, signal).catch(async err => {
            await cameraService.recordLog(deviceId, 'camera.preview.frame.failed', { reason: err.message });
            throw err;
        });
    }

    async getDiagnosticsFrame(
        deviceId: string,
        cameraProbe: import('../api/camera-probe').CameraProbe,
        signal?: AbortSignal
    ): Promise<any> {
        const source = await this.resolveProfile(deviceId, cameraProbe, signal);
        const { id: sourceId, pluginId } = source.descriptor;

        return this.sessionManager.executeWithSourceRetry(deviceId, sourceId, async (input, sig) => {
            const args = [
                '-hide_banner', '-loglevel', 'error',
                ...input.ffmpegInputArguments,
                '-map', '0:v:0',
                '-an',
                '-frames:v', '1',
                '-vf', 'scale=1280:-2',
                '-c:v', 'mjpeg',
                '-q:v', '5',
                '-f', 'image2',
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

            const buf = result.stdout;
            const jpegSoiValid = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
            const jpegEoiValid = buf.length > 2 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

            return {
                profileId: source.profile.id,
                codec: source.profile.codec,
                resolution: source.profile.width && source.profile.height ? `${source.profile.width}x${source.profile.height}` : undefined,
                exitCode: result.exitCode,
                stderr: result.stderr.slice(0, 512),
                stdoutBytes: result.stdoutBytes,
                jpegSoiValid,
                jpegEoiValid,
                durationMs: result.durationMs,
            };
        }, pluginId, signal);
    }

    async startMjpeg(
        deviceId: string,
        res: import('express').Response,
        cameraProbe: import('../api/camera-probe').CameraProbe,
        cameraService: import('../api/camera-service').CameraService,
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
                    'Pragma': 'no-cache',
                });

                void cameraService.recordLog(deviceId, 'camera.preview.started', { sourceId, pluginId });

                const args = [
                    '-hide_banner', '-loglevel', 'error',
                    ...input.ffmpegInputArguments,
                    '-map', '0:v:0',
                    '-an',
                    '-vf', 'fps=5,scale=1280:-2',
                    '-c:v', 'mjpeg',
                    '-q:v', '5',
                    '-f', 'mpjpeg',
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

                ff.stdout?.once('data', () => {
                    void cameraService.recordLog(deviceId, 'camera.preview.first_frame', { sourceId, profileId: source.profile.id, codec: source.profile.codec });
                });

                this.activeSessions.set(correlationId, ff);

                let watchdog: NodeJS.Timeout | null = null;
                const resetWatchdog = () => {
                    if (watchdog) clearTimeout(watchdog);
                    watchdog = setTimeout(() => {
                        console.error(`[PreviewService] Watchdog timeout en stream [${correlationId}]`);
                        if (!ff.killed) ff.kill('SIGTERM');
                    }, 15000);
                };
                resetWatchdog();

                const cleanup = () => {
                    if (watchdog) clearTimeout(watchdog);
                    if (!ff.killed) ff.kill('SIGTERM');
                    this.activeSessions.delete(correlationId);
                };

                res.on('close', cleanup);
                sig?.addEventListener('abort', cleanup, { once: true });

                promise.then(async (result) => {
                    cleanup();
                    if (!res.writableEnded) res.end();

                    if (result.exitCode !== 0 && result.exitCode !== null) {
                        const category = classifyMediaError(result.stderr, result.exitCode);
                        void cameraService.recordLog(deviceId, 'camera.preview.failed', {
                            exitCode: result.exitCode, category, stderr: result.stderr.slice(0, 256), stdoutBytes: result.stdoutBytes, durationMs: result.durationMs, sourceId, profileId: source.profile.id, codec: source.profile.codec
                        });
                        return reject(new MediaOperationError(result.stderr || `FFmpeg terminó con código ${result.exitCode}`, category));
                    }

                    if (result.stdoutBytes === 0) {
                        void cameraService.recordLog(deviceId, 'camera.preview.failed', {
                            exitCode: result.exitCode, category: 'invalid_media', stderr: result.stderr.slice(0, 256), stdoutBytes: result.stdoutBytes, durationMs: result.durationMs, sourceId, profileId: source.profile.id, codec: source.profile.codec
                        });
                        return reject(new MediaOperationError('FFmpeg terminó sin producir datos MJPEG', 'invalid_media'));
                    }

                    void cameraService.recordLog(deviceId, 'camera.preview.terminated', { durationMs: result.durationMs, stdoutBytes: result.stdoutBytes });
                    resolve();
                }).catch(err => {
                    console.error(`[PreviewService] MJPEG error [${correlationId}]:`, err);
                    cleanup();
                    reject(err);
                });

                // First frame detection hook via child stdout if possible
                // We rely on runner's Promise to resolve, but we could also poll res headersSent or rely on runner to emit first frame, 
                // Since we can't easily hook to outputStream first write here, let's just log when promise starts writing.
                // Wait, firstOutputAtMs is available in result. 
                // Actually the user asks to log camera.preview.first_frame.
                // We can't log it inline unless we do a small hack:
                const origWrite = res.write;
                let firstFrameLogged = false;
                res.write = function(...a: any) {
                    resetWatchdog();
                    if (!firstFrameLogged) {
                        firstFrameLogged = true;
                        void cameraService.recordLog(deviceId, 'camera.preview.first_frame', { sourceId, profileId: source.profile.id });
                    }
                    return origWrite.apply(res, a as any);
                };
            });
        }, pluginId, signal);
    }

    stopSession(sessionId: string) {
        const ff = this.activeSessions.get(sessionId);
        if (ff && !ff.killed) ff.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
    }
}
