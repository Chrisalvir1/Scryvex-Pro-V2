import { ChildProcess } from 'child_process';
import { MediaSourceSessionManager } from './media-session-manager';
import { CameraProbe } from '../api/camera-probe';
import { CameraService } from '../api/camera-service';
import { IMediaProcessRunner, DefaultMediaProcessRunner } from './media-process-runner';
import { HlsTempStorageSelector } from './hls-storage';
import { ProbedMediaSource, MediaOperationError } from './media-source';
import fs from 'fs';
import path from 'path';

export interface ConsumerLease {
    sessionId: string;
    consumerId: string;
    lastAccessAt: number;
}

export interface SourceSession {
    sessionId: string;
    cameraId: string;
    profileId: string;
    process: ChildProcess;
    consumers: Map<string, ConsumerLease>;
    hlsDir: string;
    declaredBitrate: number;
    observedAverageBitrate: number;
    observedPeakBitrate: number;
    sampleDurationMs: number;
    gracePeriodTimeout?: NodeJS.Timeout;
    watchdogInterval?: NodeJS.Timeout;
    startupPromise: Promise<string>;
    abortController: AbortController;
}

export class LiveMediaSessionManager {
    // Key: `${cameraId}:${profileId}`
    private activeSessions = new Map<string, SourceSession>();

    constructor(
        private readonly sessionManager: MediaSourceSessionManager,
        private readonly runner: IMediaProcessRunner = new DefaultMediaProcessRunner(),
        private readonly hlsStorage: HlsTempStorageSelector = new HlsTempStorageSelector()
    ) {}

    // ── Helper to parse -progress output ──
    private parseProgressData(data: string, session: SourceSession) {
        // -progress format has lines like:
        // bitrate= 1024.5kbits/s
        // out_time_us= 1000000
        const lines = data.split('\n');
        for (const line of lines) {
            if (line.startsWith('bitrate=')) {
                const val = line.split('=')[1]?.trim();
                if (val && val !== 'N/A') {
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) {
                        session.observedPeakBitrate = Math.max(session.observedPeakBitrate, parsed);
                        session.observedAverageBitrate = session.observedAverageBitrate === 0 ? parsed : (session.observedAverageBitrate * 0.9 + parsed * 0.1);
                    }
                }
            } else if (line.startsWith('out_time_us=')) {
                const val = line.split('=')[1]?.trim();
                if (val && val !== 'N/A') {
                    const parsed = parseInt(val, 10);
                    if (!isNaN(parsed)) {
                        session.sampleDurationMs = Math.floor(parsed / 1000);
                    }
                }
            }
        }
    }

    /**
     * Starts or joins an existing SourceSession for the given cameraId + profileId.
     * Returns the generated sessionId.
     */
    async startSession(
        cameraId: string,
        profileId: string,
        cameraProbe: CameraProbe,
        cameraService: CameraService,
        signal?: AbortSignal
    ): Promise<string> {
        const sessionKey = `${cameraId}:${profileId}`;
        let session = this.activeSessions.get(sessionKey);

        if (session) {
            // Join existing
            if (session.gracePeriodTimeout) {
                clearTimeout(session.gracePeriodTimeout);
                session.gracePeriodTimeout = undefined;
            }
            const consumerId = Math.random().toString(36).substring(2, 10);
            session.consumers.set(consumerId, {
                sessionId: session.sessionId,
                consumerId,
                lastAccessAt: Date.now()
            });
            // Wait for existing startup if not finished
            await session.startupPromise;
            return consumerId;
        }

        // --- Start new Single-Flight ---
        const consumerId = Math.random().toString(36).substring(2, 10);
        const producerId = `prod_${Math.random().toString(36).substring(2, 10)}`;
        const hlsDir = this.hlsStorage.getProducerDir(cameraId, producerId);

        const abortController = new AbortController();
        if (signal) {
            signal.addEventListener('abort', () => abortController.abort(), { once: true });
        }

        let resolveStartup!: (val: string) => void;
        let rejectStartup!: (reason?: any) => void;
        const startupPromise = new Promise<string>((res, rej) => {
            resolveStartup = res;
            rejectStartup = rej;
        });

        const newSession: SourceSession = {
            sessionId: producerId,
            cameraId,
            profileId,
            process: null as unknown as ChildProcess,
            consumers: new Map([[consumerId, { sessionId: producerId, consumerId, lastAccessAt: Date.now() }]]),
            hlsDir,
            declaredBitrate: 0,
            observedAverageBitrate: 0,
            observedPeakBitrate: 0,
            sampleDurationMs: 0,
            startupPromise,
            abortController
        };
        
        this.activeSessions.set(sessionKey, newSession);

        // Run async startup logic
        this.executeProducer(newSession, cameraProbe, cameraService)
            .then(() => {
                resolveStartup(consumerId);
            })
            .catch((err) => {
                this.cleanupSession(sessionKey);
                rejectStartup(err);
            });

        return startupPromise;
    }

    private async executeProducer(
        session: SourceSession,
        cameraProbe: CameraProbe,
        cameraService: CameraService
    ): Promise<void> {
        const probedSources = await cameraProbe.getProbedSources(session.cameraId);
        if (!probedSources) throw new MediaOperationError('No probed sources found', 'not_retryable');
        
        const source = probedSources.find(s => s.profile.id === session.profileId);
        if (!source) throw new MediaOperationError(`Profile ${session.profileId} not found`, 'not_retryable');

        const { id: sourceId, pluginId } = source.descriptor;

        session.declaredBitrate = source.profile.bitrate || 0;

        await this.sessionManager.executeWithSourceRetry(session.cameraId, sourceId, async (input, sig) => {
            return new Promise<void>((resolve, reject) => {
                void cameraService.recordLog(session.cameraId, 'camera.live.started', { 
                    sourceId, profileId: session.profileId, sessionId: session.sessionId 
                });

                const playlistPath = path.join(session.hlsDir, 'index.m3u8');
                const segmentPath = path.join(session.hlsDir, 'segment_%03d.ts');
                
                // We use tcp progress url or just pipe progress to stdout and read it.
                // Since we use the process runner, we can read stdout if we tell ffmpeg to log progress to stdout.
                // Note: -progress pipe:1 will write progress to stdout, so we shouldn't use stdout for anything else.

                const hasAudio = !!source.profile.audioCodec;

                const args = [
                    '-hide_banner',
                    ...input.ffmpegInputArguments,
                    '-map', '0:v:0'
                ];

                if (hasAudio) {
                    args.push('-map', '0:a:0');
                }

                args.push(
                    // Progress to stdout
                    '-progress', 'pipe:1',

                    // Video: HEVC to H264 720p 15fps
                    '-c:v', 'libx264',
                    '-preset', 'ultrafast',
                    '-tune', 'zerolatency',
                    '-vf', 'scale=-2:720',
                    '-r', '15',
                    '-g', '15',
                    '-pix_fmt', 'yuv420p'
                );

                if (hasAudio) {
                    args.push(
                        // Audio: AAC 16 kHz -> AAC-LC mono 48 kHz, 64 kbps
                        '-c:a', 'aac',
                        '-ac', '1',
                        '-ar', '48000',
                        '-b:a', '64k'
                    );
                }

                args.push(
                    // HLS Config
                    '-f', 'hls',
                    '-hls_time', '1',
                    '-hls_list_size', '3',
                    '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
                    '-hls_segment_type', 'mpegts',
                    '-hls_segment_filename', segmentPath,
                    playlistPath
                );

                const { process: ff, promise } = this.runner.spawnStreaming({
                    command: 'ffmpeg',
                    args,
                    signal: sig,
                    inputStream: input.inputStream,
                    inputBuffer: input.inputBuffer,
                });

                session.process = ff;

                // Watchdog to enforce size limits and inactivity
                session.watchdogInterval = setInterval(() => {
                    if (session.abortController.signal.aborted) return;
                    
                    try {
                        this.hlsStorage.validateProducerSize(session.cameraId, session.sessionId);
                    } catch (e: any) {
                        console.error(`[LiveMediaSessionManager] ${e.message}`);
                        session.abortController.abort();
                        return;
                    }

                    // Check viewers inactivity (> 30s)
                    const now = Date.now();
                    for (const [cid, lease] of session.consumers.entries()) {
                        if (now - lease.lastAccessAt > 30000) {
                            session.consumers.delete(cid);
                        }
                    }

                    if (session.consumers.size === 0 && !session.gracePeriodTimeout) {
                        session.gracePeriodTimeout = setTimeout(() => {
                            const current = this.activeSessions.get(`${session.cameraId}:${session.profileId}`);
                            if (current === session && current.consumers.size === 0) {
                                current.abortController.abort();
                            }
                        }, 15000);
                    }
                }, 5000);

                // Parse progress from stdout (since we passed -progress pipe:1)
                ff.stdout?.on('data', (data: Buffer) => {
                    this.parseProgressData(data.toString(), session);
                });

                const cleanup = () => {
                    if (!ff.killed) ff.kill('SIGTERM');
                    if (session.watchdogInterval) clearInterval(session.watchdogInterval);
                };

                // Tie FFmpeg abort to our abortController
                session.abortController.signal.addEventListener('abort', cleanup, { once: true });
                sig?.addEventListener('abort', cleanup, { once: true });

                promise.then((result) => {
                    cleanup();
                    this.cleanupSession(`${session.cameraId}:${session.profileId}`);
                    void cameraService.recordLog(session.cameraId, 'camera.live.terminated', { 
                        durationMs: result.durationMs,
                        bitrateAvg: session.observedAverageBitrate,
                        bitrateMax: session.observedPeakBitrate,
                        exitCode: result.exitCode
                    });
                    resolve();
                }).catch(err => {
                    cleanup();
                    this.cleanupSession(`${session.cameraId}:${session.profileId}`);
                    reject(err);
                });

                // Wait until playlist and at least one >0 bytes segment exists
                const checkReady = setInterval(() => {
                    if (session.abortController.signal.aborted) {
                        clearInterval(checkReady);
                        reject(new MediaOperationError('Aborted during startup', 'cancelled'));
                        return;
                    }

                    if (fs.existsSync(playlistPath)) {
                        const files = fs.readdirSync(session.hlsDir);
                        const tsFiles = files.filter(f => f.endsWith('.ts'));
                        for (const ts of tsFiles) {
                            const stat = fs.statSync(path.join(session.hlsDir, ts));
                            if (stat.size > 0) {
                                clearInterval(checkReady);
                                resolve();
                                return;
                            }
                        }
                    }
                }, 200);

                // Startup timeout 10 seconds
                setTimeout(() => {
                    clearInterval(checkReady);
                    if (!ff.killed && session.consumers.size > 0) {
                        reject(new MediaOperationError('HLS playlist/segment not created in time', 'unknown'));
                        session.abortController.abort();
                    }
                }, 10000);
            });
        }, pluginId, session.abortController.signal);
    }

    heartbeatConsumer(cameraId: string, profileId: string, consumerId: string): boolean {
        const sessionKey = `${cameraId}:${profileId}`;
        const session = this.activeSessions.get(sessionKey);
        if (!session) return false;

        const lease = session.consumers.get(consumerId);
        if (!lease) return false;

        lease.lastAccessAt = Date.now();
        if (session.gracePeriodTimeout) {
            clearTimeout(session.gracePeriodTimeout);
            session.gracePeriodTimeout = undefined;
        }
        return true;
    }

    removeConsumer(cameraId: string, profileId: string, consumerId: string) {
        const sessionKey = `${cameraId}:${profileId}`;
        const session = this.activeSessions.get(sessionKey);
        if (!session) return;

        session.consumers.delete(consumerId);

        if (session.consumers.size === 0 && !session.gracePeriodTimeout) {
            session.gracePeriodTimeout = setTimeout(() => {
                const s = this.activeSessions.get(sessionKey);
                if (s && s.consumers.size === 0) {
                    s.abortController.abort();
                }
            }, 15000);
        }
    }

    getSessionInfo(cameraId: string, profileId: string) {
        const session = this.activeSessions.get(`${cameraId}:${profileId}`);
        return session ? {
            sessionId: session.sessionId,
            consumers: session.consumers.size,
            declaredBitrate: session.declaredBitrate,
            observedAverageBitrate: session.observedAverageBitrate,
            observedPeakBitrate: session.observedPeakBitrate,
            sampleDurationMs: session.sampleDurationMs
        } : null;
    }

    getHlsDir(cameraId: string, profileId: string): string | null {
        return this.activeSessions.get(`${cameraId}:${profileId}`)?.hlsDir ?? null;
    }

    private cleanupSession(sessionKey: string) {
        const session = this.activeSessions.get(sessionKey);
        if (session) {
            this.activeSessions.delete(sessionKey);
            this.hlsStorage.cleanupProducerDir(session.cameraId, session.sessionId);
        }
    }
}
