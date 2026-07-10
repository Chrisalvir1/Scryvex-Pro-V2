import { RawStreamInfo, normalizeCodec } from '../cameras/camera-adapter';
import { ResolvedMediaInput } from './media-resolvers';
import { MediaErrorCategory, classifyMediaError } from '../cameras/camera-adapter';
import { IMediaProcessRunner, DefaultMediaProcessRunner } from './media-process-runner';

export interface ProbeResult {
    success: boolean;
    durationMs: number;
    exitCode: number | null;
    errorCategory?: MediaErrorCategory;
    stderrSummary?: string;
    rawInfo?: RawStreamInfo;
}

function parseFraction(val?: string): number | undefined {
    if (!val || val === '0/0') return undefined;
    const parts = val.split('/');
    if (parts.length === 2) {
        const num = Number(parts[0]);
        const den = Number(parts[1]);
        if (den !== 0) return num / den;
    }
    return Number(val) || undefined;
}

export class MediaProbeService {
    constructor(private runner: IMediaProcessRunner = new DefaultMediaProcessRunner()) {}

    async probeMediaStream(input: ResolvedMediaInput, timeoutMs: number = 10000, signal?: AbortSignal): Promise<ProbeResult> {
        if (input.probeStrategy === 'webrtc_analyzer') {
            return {
                success: false,
                durationMs: 0,
                exitCode: null,
                errorCategory: 'unsupported_transport',
                stderrSummary: 'WebRTC no está soportado en FFprobe de servidor'
            };
        }

        const args = [
            '-v', 'error',
            '-rw_timeout', (timeoutMs * 1000).toString(),
            '-analyzeduration', '5000000',
            '-probesize', '5000000',
            '-show_streams',
            '-show_format',
            '-of', 'json',
            ...input.ffmpegInputArguments
        ];

        const result = await this.runner.run({
            command: 'ffprobe',
            args,
            timeoutMs: timeoutMs + 2000,
            signal,
            inputStream: input.inputStream,
            inputBuffer: input.inputBuffer
        });

        const probeResult: ProbeResult = {
            success: result.exitCode === 0,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
        };

        if (result.exitCode !== 0) {
            probeResult.errorCategory = classifyMediaError(result.stderr, result.exitCode);
            if (result.stderr === 'Aborted') probeResult.errorCategory = 'cancelled';
            probeResult.stderrSummary = result.stderr.substring(0, 500).replace(/\n/g, ' ').trim() || 'Unknown error';
        }

        try {
            const stdoutStr = result.stdout.toString('utf-8').trim();
            if (stdoutStr) {
                const parsed = JSON.parse(stdoutStr);
                const vStream = parsed.streams?.find((s: any) => s.codec_type === 'video');
                const aStream = parsed.streams?.find((s: any) => s.codec_type === 'audio');

                if (!vStream && !aStream) {
                    probeResult.success = false;
                    probeResult.errorCategory = 'no_video_stream';
                    probeResult.stderrSummary = 'El stream fue analizado pero no contiene video ni audio.';
                    return probeResult;
                }

                const rawInfo: RawStreamInfo = {
                    transport: input.kind as any,
                    hasVideo: !!vStream,
                    hasAudio: !!aStream
                };

                if (vStream) {
                    const codecNames = normalizeCodec(vStream.codec_name || 'unknown');
                    rawInfo.video = {
                        rawCodec: vStream.codec_name || 'unknown',
                        normalizedCodec: codecNames.normalizedCodec,
                        displayCodec: codecNames.displayCodec,
                        profile: vStream.profile,
                        level: vStream.level?.toString(),
                        width: vStream.width || 0,
                        height: vStream.height || 0,
                        fps: parseFraction(vStream.r_frame_rate || vStream.avg_frame_rate),
                        bitrate: vStream.bit_rate ? Number(vStream.bit_rate) : undefined,
                        pixFmt: vStream.pix_fmt,
                        colorSpace: vStream.color_space,
                        colorTransfer: vStream.color_transfer,
                        colorPrimaries: vStream.color_primaries,
                        verifiedFromBitstream: true
                    };
                }

                if (aStream) {
                    const codecNames = normalizeCodec(aStream.codec_name || 'unknown');
                    rawInfo.audio = {
                        rawCodec: aStream.codec_name || 'unknown',
                        normalizedCodec: codecNames.normalizedCodec,
                        displayCodec: codecNames.displayCodec,
                        sampleRate: aStream.sample_rate ? Number(aStream.sample_rate) : 0,
                        channels: aStream.channels || 1,
                        bitrate: aStream.bit_rate ? Number(aStream.bit_rate) : undefined,
                        verifiedFromBitstream: true
                    };
                }

                probeResult.rawInfo = rawInfo;
                if (rawInfo.hasVideo) {
                    probeResult.success = true;
                    probeResult.errorCategory = undefined;
                }
            }
        } catch (e) {
            probeResult.success = false;
            probeResult.errorCategory = 'invalid_media';
            probeResult.stderrSummary = `Fallo al parsear JSON de ffprobe: ${(e as Error).message}`;
        }

        return probeResult;
    }
}
