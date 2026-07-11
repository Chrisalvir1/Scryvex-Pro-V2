import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SystemService } from '../api/system-service';

const execFileAsync = promisify(execFile);

export type DiagnosticsStatus = 'not_checked' | 'checking' | 'ready' | 'degraded' | 'failed';

export interface CodecCapabilities {
    decoder: boolean;
    encoder: boolean;
    parser: boolean;
    bitstreamFilter: boolean;
}

export interface MediaCapabilities {
    status: DiagnosticsStatus;
    checkedAt?: string;
    durationMs?: number;
    source: 'runtime';
    containerArchitecture: string;
    platform: string;
    ffmpeg: {
        installed: boolean;
        usable: boolean;
        path?: string;
        version?: string;
    };
    ffprobe: {
        installed: boolean;
        usable: boolean;
        path?: string;
        version?: string;
    };
    protocols: Record<string, boolean>;
    muxers: Record<string, boolean>;
    decoders: Record<string, boolean>; // Still keeping simple lookup for others
    encoders: Record<string, boolean>; // Still keeping simple lookup for others
    videoCodecs: {
        h264: CodecCapabilities;
        h265: CodecCapabilities;
    };
    hardwareAcceleration: {
        compiled: string[];
        devices: string[];
        validated: string[];
        usable: boolean;
    };
    functionalTests: {
        syntheticJpeg?: { supported: boolean; success: boolean; reason?: string };
        mpjpegMuxer?: { supported: boolean; success: boolean; reason?: string };
        opusEncoding?: { supported: boolean; success: boolean; reason?: string };
        h264Encoding?: { supported: boolean; success: boolean; reason?: string };
        h265Encoding?: { supported: boolean; success: boolean; reason?: string };
        h264LocalRemux?: { supported: boolean; success: boolean; reason?: string; details?: any };
        h265LocalRemux?: { supported: boolean; success: boolean; reason?: string; details?: any };
    };
    errors: any[];
}

export interface SystemCapabilitiesResponse {
    status: DiagnosticsStatus;
    lastSuccessfulCheck?: {
        checkedAt: string;
        result: MediaCapabilities;
    };
    currentCheckStartedAt?: string;
    capabilities: MediaCapabilities; // the active/latest one
}

export class SystemDiagnosticsService {
    private static instance: SystemDiagnosticsService;
    private capabilities: MediaCapabilities = this.getInitialState();
    private lastSuccessfulCheck?: { checkedAt: string; result: MediaCapabilities };
    private currentCheckStartedAt?: string;
    private systemService?: SystemService;
    private isChecking = false;

    private constructor() {}

    static getInstance(): SystemDiagnosticsService {
        if (!SystemDiagnosticsService.instance) {
            SystemDiagnosticsService.instance = new SystemDiagnosticsService();
        }
        return SystemDiagnosticsService.instance;
    }

    setSystemService(service: SystemService) {
        this.systemService = service;
    }

    private getInitialState(): MediaCapabilities {
        return {
            status: 'not_checked',
            source: 'runtime',
            containerArchitecture: process.arch,
            platform: process.platform,
            ffmpeg: { installed: false, usable: false },
            ffprobe: { installed: false, usable: false },
            protocols: {},
            muxers: {},
            decoders: {},
            encoders: {},
            videoCodecs: {
                h264: { decoder: false, encoder: false, parser: false, bitstreamFilter: false },
                h265: { decoder: false, encoder: false, parser: false, bitstreamFilter: false }
            },
            hardwareAcceleration: { compiled: [], devices: [], validated: [], usable: false },
            functionalTests: {},
            errors: []
        };
    }

    private async runCommandStr(cmd: string, args: string[]): Promise<string> {
        try {
            const { stdout } = await execFileAsync(cmd, args, {
                timeout: 15_000,
                maxBuffer: 4 * 1024 * 1024,
                encoding: 'utf8',
            });
            return stdout;
        } catch (e: any) {
            if (e.code === 'ENOENT') throw new Error(`Command not found: ${cmd}`);
            throw e; // We catch this outside for specific test details
        }
    }

    private async runCommandBuf(cmd: string, args: string[]): Promise<Buffer> {
        try {
            const { stdout } = await execFileAsync(cmd, args, {
                timeout: 15_000,
                maxBuffer: 8 * 1024 * 1024,
                encoding: 'buffer',
            });
            return stdout;
        } catch (e: any) {
            if (e.code === 'ENOENT') throw new Error(`Command not found: ${cmd}`);
            throw e;
        }
    }

    private async findExecutable(name: string): Promise<string | undefined> {
        try {
            // Use 'which' on unix, fallback in windows shouldn't happen for HA add-on
            const output = await this.runCommandStr('which', [name]);
            return output.trim();
        } catch {
            return undefined;
        }
    }

    async refresh(): Promise<SystemCapabilitiesResponse> {
        if (this.isChecking) {
            return this.getResponse();
        }
        
        this.isChecking = true;
        this.currentCheckStartedAt = new Date().toISOString();
        const start = Date.now();
        const newState = this.getInitialState();
        newState.status = 'checking';
        this.capabilities = newState;

        try {
            newState.ffmpeg.path = await this.findExecutable('ffmpeg');
            newState.ffprobe.path = await this.findExecutable('ffprobe');

            newState.ffmpeg.installed = !!newState.ffmpeg.path;
            newState.ffprobe.installed = !!newState.ffprobe.path;

            if (newState.ffmpeg.installed && newState.ffmpeg.path) {
                try {
                    const verOut = await this.runCommandStr(newState.ffmpeg.path, ['-version']);
                    newState.ffmpeg.version = verOut.split('\n')[0]?.split(' ')[2] || 'unknown';
                    newState.ffmpeg.usable = true;
                    
                    const protocols = await this.runCommandStr(newState.ffmpeg.path, ['-protocols']);
                    newState.protocols = {
                        rtsp: protocols.includes(' rtsp '),
                        tcp: protocols.includes(' tcp '),
                        udp: protocols.includes(' udp ')
                    };

                    const muxers = await this.runCommandStr(newState.ffmpeg.path, ['-muxers']);
                    newState.muxers = {
                        mpjpeg: muxers.includes(' mpjpeg '),
                        rtsp: muxers.includes(' rtsp '),
                        mp4: muxers.includes(' mp4 ')
                    };

                    const decoders = await this.runCommandStr(newState.ffmpeg.path, ['-decoders']);
                    const encoders = await this.runCommandStr(newState.ffmpeg.path, ['-encoders']);
                    const bsfs = await this.runCommandStr(newState.ffmpeg.path, ['-bsfs']);
                    const filters = await this.runCommandStr(newState.ffmpeg.path, ['-filters']);
                    // There is no explicit `-parsers` standard output that is easily parseable without breaking format in some older ffmpeg, 
                    // but we can assume parser presence if decoder exists usually, though let's grep for ' h264 ' in ffmpeg -hide_banner -parsers if supported
                    let parsers = '';
                    try { parsers = await this.runCommandStr(newState.ffmpeg.path, ['-hide_banner', '-parsers']); } catch(e) {}

                    newState.videoCodecs.h264 = {
                        decoder: decoders.includes(' h264 '),
                        encoder: encoders.includes(' libx264 ') || encoders.includes(' h264_'),
                        parser: parsers.includes(' h264 '),
                        bitstreamFilter: bsfs.includes('h264_mp4toannexb') || bsfs.includes('h264_metadata')
                    };

                    newState.videoCodecs.h265 = {
                        decoder: decoders.includes(' hevc '),
                        encoder: encoders.includes(' libx265 ') || encoders.includes(' hevc_'),
                        parser: parsers.includes(' hevc '),
                        bitstreamFilter: bsfs.includes('hevc_mp4toannexb') || bsfs.includes('hevc_metadata')
                    };
                    
                    newState.encoders = {
                        mjpeg: encoders.includes(' mjpeg '),
                        opus: encoders.includes(' opus ') || encoders.includes(' libopus ')
                    };

                    const hwaccels = await this.runCommandStr(newState.ffmpeg.path, ['-hwaccels']);
                    newState.hardwareAcceleration.compiled = hwaccels.split('\n').slice(1).map(s => s.trim()).filter(s => s);
                } catch (e: any) {
                    newState.ffmpeg.usable = false;
                    newState.errors.push({ source: 'ffmpeg_static', message: e.message });
                }
            }

            if (newState.ffprobe.installed && newState.ffprobe.path) {
                try {
                    const verOut = await this.runCommandStr(newState.ffprobe.path, ['-version']);
                    newState.ffprobe.version = verOut.split('\n')[0]?.split(' ')[2] || 'unknown';
                    newState.ffprobe.usable = true;
                } catch (e: any) {
                    newState.ffprobe.usable = false;
                    newState.errors.push({ source: 'ffprobe_static', message: e.message });
                }
            }

            // --- FUNCTIONAL TESTS ---
            if (newState.ffmpeg.usable) {
                
                // 1. Synthetic JPEG (Binary output parsing)
                try {
                    newState.functionalTests.syntheticJpeg = { supported: true, success: false };
                    
                    const stdoutBuf = await this.runCommandBuf(newState.ffmpeg.path!, [
                        '-hide_banner',
                        '-loglevel', 'error',
                        '-f', 'lavfi',
                        '-i', 'testsrc=size=320x240:rate=1',
                        '-frames:v', '1',
                        '-f', 'image2pipe',
                        '-vcodec', 'mjpeg',
                        'pipe:1'
                    ]);
                    
                    // Validate JPEG strictly in memory
                    if (stdoutBuf.length > 100) {
                        if (stdoutBuf[0] === 0xFF && stdoutBuf[1] === 0xD8) {
                            if (stdoutBuf[stdoutBuf.length - 2] === 0xFF && stdoutBuf[stdoutBuf.length - 1] === 0xD9) {
                                
                                // Test FFprobe functionally using a temporary file
                                if (newState.ffprobe.usable && newState.ffprobe.path) {
                                    const testFile = join(tmpdir(), `scryvex-media-${process.pid}-${randomUUID()}.jpg`);
                                    try {
                                        await fs.writeFile(testFile, stdoutBuf);
                                        const probeOut = await this.runCommandStr(newState.ffprobe.path, ['-v', 'error', '-show_streams', '-of', 'json', testFile]);
                                        const probeJson = JSON.parse(probeOut);
                                        if (probeJson.streams && probeJson.streams[0].codec_name === 'mjpeg') {
                                            newState.functionalTests.syntheticJpeg.success = true;
                                        } else {
                                            newState.functionalTests.syntheticJpeg.reason = 'FFprobe returned invalid JSON or not mjpeg';
                                        }
                                    } finally {
                                        await fs.unlink(testFile).catch(() => undefined);
                                    }
                                } else {
                                    // If no ffprobe, just checking binary magic bytes is considered success
                                    newState.functionalTests.syntheticJpeg.success = true;
                                    newState.functionalTests.syntheticJpeg.reason = 'FFprobe omitted (not installed)';
                                }
                            } else {
                                newState.functionalTests.syntheticJpeg.reason = 'Missing FF D9 EOF marker';
                            }
                        } else {
                            newState.functionalTests.syntheticJpeg.reason = 'Missing FF D8 SOF marker';
                        }
                    } else {
                        newState.functionalTests.syntheticJpeg.reason = `Buffer too small: ${stdoutBuf.length} bytes`;
                    }
                } catch (e: any) {
                    newState.functionalTests.syntheticJpeg!.reason = e.message;
                    newState.errors.push({ test: 'syntheticJpeg', error: this.systemService?.sanitizeMediaDiagnosticMessage(e.message) ?? e.message });
                }

                // 1.5 mpjpegMuxer
                if (newState.muxers.mpjpeg) {
                    try {
                        newState.functionalTests.mpjpegMuxer = { supported: true, success: false };
                        
                        const stdoutBuf = await this.runCommandBuf(newState.ffmpeg.path!, [
                            '-hide_banner',
                            '-loglevel', 'error',
                            '-f', 'lavfi',
                            '-i', 'testsrc=size=320x240:rate=1',
                            '-frames:v', '1',
                            '-f', 'mpjpeg',
                            '-vcodec', 'mjpeg',
                            'pipe:1'
                        ]);
                        
                        const header = stdoutBuf.toString('ascii', 0, 100);
                        if (stdoutBuf.length > 50 && (header.includes('boundary=') || header.includes('--ffmpeg'))) {
                            newState.functionalTests.mpjpegMuxer.success = true;
                        } else {
                            newState.functionalTests.mpjpegMuxer.reason = 'Missing MIME boundary in mpjpeg output';
                        }
                    } catch (e: any) {
                        newState.functionalTests.mpjpegMuxer!.reason = e.message;
                        newState.errors.push({ test: 'mpjpegMuxer', error: this.systemService?.sanitizeMediaDiagnosticMessage(e.message) ?? e.message });
                    }
                }

                // 1.6 opusEncoding
                if (newState.encoders.opus) {
                    try {
                        newState.functionalTests.opusEncoding = { supported: true, success: false };
                        const testOut = join(tmpdir(), `opus-out-${process.pid}-${randomUUID()}.ogg`);
                        
                        try {
                            await this.runCommandStr(newState.ffmpeg.path!, [
                                '-hide_banner', '-loglevel', 'error', '-y', 
                                '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', 
                                '-t', '1', 
                                '-c:a', 'libopus', 
                                '-ar', '48000', 
                                '-ac', '1',
                                '-frame_duration', '20',
                                testOut
                            ]);

                            if (newState.ffprobe.usable && newState.ffprobe.path) {
                                const probeOut = await this.runCommandStr(newState.ffprobe.path, ['-v', 'error', '-show_streams', '-of', 'json', testOut]);
                                const probeJson = JSON.parse(probeOut);
                                const stream = probeJson.streams?.[0];
                                if (stream && stream.codec_name === 'opus' && String(stream.sample_rate) === '48000' && stream.channels === 1) {
                                    newState.functionalTests.opusEncoding.success = true;
                                } else {
                                    newState.functionalTests.opusEncoding.reason = 'FFprobe returned invalid opus, sample rate, or channels';
                                }
                            } else {
                                newState.functionalTests.opusEncoding.success = false;
                                newState.functionalTests.opusEncoding.reason = 'not_verified (ffprobe missing)';
                            }
                        } finally {
                            await fs.unlink(testOut).catch(() => undefined);
                        }
                    } catch (e: any) {
                        newState.functionalTests.opusEncoding!.reason = e.message;
                        newState.errors.push({ test: 'opusEncoding', error: this.systemService?.sanitizeMediaDiagnosticMessage(e.message) ?? e.message });
                    }
                }

                // 2. Local Remux Tests (Simulated with synthetic input, copying codec)
                // H.264
                if (newState.videoCodecs.h264.encoder && newState.videoCodecs.h264.parser && newState.videoCodecs.h264.bitstreamFilter) {
                    newState.functionalTests.h264LocalRemux = { supported: true, success: false };
                    const testIn = join(tmpdir(), `remux-in-${process.pid}-${randomUUID()}.mp4`);
                    const testOutMp4 = join(tmpdir(), `remux-out-${process.pid}-${randomUUID()}.mp4`);
                    const testOutTs = join(tmpdir(), `remux-out-${process.pid}-${randomUUID()}.ts`);
                    
                    try {
                        // Generación del fixture
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1', '-c:v', 'libx264', testIn
                        ]);
                        
                        // Remux MP4 a MP4 (sin AnnexB)
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-i', testIn, '-c:v', 'copy', testOutMp4
                        ]);

                        // Remux MP4 a MPEG-TS (con AnnexB)
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-i', testIn, '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', testOutTs
                        ]);

                        newState.functionalTests.h264LocalRemux.success = true;
                        newState.functionalTests.h264LocalRemux.details = { 
                            in: 'mp4', 
                            outMp4: 'mp4', 
                            outTs: 'ts',
                            codec: 'h264', 
                            filterRequiredForTs: true,
                            filterUsedForTs: 'h264_mp4toannexb',
                            videoOperation: 'copy' 
                        };
                    } catch (e: any) {
                        newState.functionalTests.h264LocalRemux.reason = e.message;
                        newState.errors.push({ test: 'h264LocalRemux', error: this.systemService?.sanitizeMediaDiagnosticMessage(e.message) ?? e.message });
                    } finally {
                        await fs.unlink(testIn).catch(() => undefined);
                        await fs.unlink(testOutMp4).catch(() => undefined);
                        await fs.unlink(testOutTs).catch(() => undefined);
                    }
                } else {
                    newState.functionalTests.h264LocalRemux = { supported: false, success: false, reason: 'Missing encoder, parser or BSF for generating test file.' };
                }

                // H.265
                if (newState.videoCodecs.h265.encoder && newState.videoCodecs.h265.parser && newState.videoCodecs.h265.bitstreamFilter) {
                    newState.functionalTests.h265LocalRemux = { supported: true, success: false };
                    const testIn = join(tmpdir(), `remux-in-hevc-${process.pid}-${randomUUID()}.mp4`);
                    const testOutMp4 = join(tmpdir(), `remux-out-hevc-${process.pid}-${randomUUID()}.mp4`);
                    const testOutTs = join(tmpdir(), `remux-out-hevc-${process.pid}-${randomUUID()}.ts`);
                    
                    try {
                        // Generación de fixture
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1', '-c:v', 'libx265', testIn
                        ]);
                        
                        // MP4 a MP4 (sin AnnexB)
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-i', testIn, '-c:v', 'copy', testOutMp4
                        ]);

                        // MP4 a MPEG-TS (con AnnexB)
                        await this.runCommandStr(newState.ffmpeg.path!, [
                            '-hide_banner', '-loglevel', 'error', '-y', '-i', testIn, '-c:v', 'copy', '-bsf:v', 'hevc_mp4toannexb', testOutTs
                        ]);

                        newState.functionalTests.h265LocalRemux.success = true;
                        newState.functionalTests.h265LocalRemux.details = { 
                            in: 'mp4', 
                            outMp4: 'mp4', 
                            outTs: 'ts',
                            codec: 'h265', 
                            filterRequiredForTs: true,
                            filterUsedForTs: 'hevc_mp4toannexb',
                            videoOperation: 'copy' 
                        };
                    } catch (e: any) {
                        newState.functionalTests.h265LocalRemux.reason = e.message;
                        newState.errors.push({ test: 'h265LocalRemux', error: this.systemService?.sanitizeMediaDiagnosticMessage(e.message) ?? e.message });
                    } finally {
                        await fs.unlink(testIn).catch(() => undefined);
                        await fs.unlink(testOutMp4).catch(() => undefined);
                        await fs.unlink(testOutTs).catch(() => undefined);
                    }
                } else {
                    newState.functionalTests.h265LocalRemux = { supported: false, success: false, reason: 'Missing HEVC encoder, parser or BSF for generating test file.' };
                }
            }

            // Assign proper degraded state
            if (!newState.ffmpeg.usable && !newState.ffprobe.usable) {
                newState.status = 'failed';
            } else if (!newState.ffmpeg.usable || !newState.ffprobe.usable || newState.errors.length > 0) {
                newState.status = 'degraded';
            } else {
                newState.status = 'ready';
            }
        } catch (err: any) {
            newState.status = 'failed';
            newState.errors.push({ fatal: true, error: this.systemService?.sanitizeMediaDiagnosticMessage(err.message) ?? err.message });
        } finally {
            newState.checkedAt = new Date().toISOString();
            newState.durationMs = Date.now() - start;
            this.capabilities = newState;
            
            if (newState.status === 'ready' || newState.status === 'degraded') {
                this.lastSuccessfulCheck = { checkedAt: newState.checkedAt, result: newState };
            }

            this.isChecking = false;

            // Log summary to database
            if (this.systemService) {
                const summary = {
                    ffmpegAvailable: newState.ffmpeg.installed,
                    ffprobeAvailable: newState.ffprobe.installed,
                    rtspSupported: newState.protocols.rtsp,
                    h264RemuxCapable: newState.videoCodecs.h264.parser && newState.videoCodecs.h264.bitstreamFilter,
                    h265RemuxCapable: newState.videoCodecs.h265.parser && newState.videoCodecs.h265.bitstreamFilter,
                    errorsLength: newState.errors.length
                };
                
                await this.systemService.recordLog(
                    'system.media.capabilities.detected',
                    summary,
                    newState.status === 'ready' ? 'info' : (newState.status === 'failed' ? 'error' : 'degraded')
                );
            }
        }

        return this.getResponse();
    }

    getResponse(): SystemCapabilitiesResponse {
        return {
            status: this.capabilities.status,
            lastSuccessfulCheck: this.lastSuccessfulCheck,
            currentCheckStartedAt: this.currentCheckStartedAt,
            capabilities: this.capabilities
        };
    }
}
