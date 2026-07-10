import type { CameraProtocol } from '../types/camera';

export type { CameraProtocol };

export type DiscoveryStatus = 'pending' | 'discovering' | 'online' | 'offline' | 'authentication_failed' | 'unsupported' | 'error';

/** Unified error categories for all media probes (RTSP, HTTP, HLS, pipe, buffer). */
export type MediaErrorCategory =
    | 'dns_error'
    | 'connection_refused'
    | 'connection_timeout'
    | 'authentication_failed'
    | 'expired_source'
    | 'rtsp_404'
    | 'rtsp_454_session_not_found'
    | 'rtsp_461_transport_unsupported'
    | 'malformed_uri'
    | 'malformed_source'
    | 'invalid_media'
    | 'no_video_stream'
    | 'unsupported_codec'
    | 'unsupported_transport'
    | 'process_spawn_failed'
    | 'process_timeout'
    | 'cancelled'
    | 'unknown';

/** @deprecated Use MediaErrorCategory */
export type RtspErrorCategory = MediaErrorCategory;

/** Status of a single RTSP profile validation attempt. */
export type ProfileValidationStatus =
    | 'valid'
    | 'invalid'
    | 'authentication_failed'
    | 'timeout'
    | 'unsupported_codec'
    | 'no_video_stream'
    | 'malformed_uri'
    | 'transport_failed'
    | 'not_tested';

import type { CapabilityEvidence } from '../capabilities/capability-evidence';
export type { CapabilityEvidence };

export interface CameraConnectionInput {
    id?: string;
    ip: string;
    port: number;
    onvif_port?: number;
    rtsp_url?: string;
    username?: string;
    password?: string;
    config?: Record<string, unknown>;
}

/** Extended stream profile — includes per-profile RTSP validation result. */
export interface StreamProfile {
    id: string;
    name?: string;
    codec?: string;
    rawCodec?: string;
    normalizedCodec?: string;
    displayCodec?: string;
    profile?: string;
    level?: string;
    pixFmt?: string;
    colorSpace?: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    maxBitrate?: number;
    audioCodec?: string;
    audioSampleRate?: number;
    audioChannels?: number;
    audioBitrate?: number;
    streamUri?: string;
    snapshotUri?: string;
    /** Result of the independent RTSP probe for this profile. */
    validationStatus?: ProfileValidationStatus;
    validationErrorCategory?: RtspErrorCategory;
    validationErrorMessage?: string;
    validationTransport?: 'tcp' | 'udp';
    validationDurationMs?: number;
    timeToFirstPacketMs?: number;
    /** Can this profile be remuxed (stream-copied) without re-encoding video? */
    canRemuxVideo?: boolean;
    /** Can the audio be stream-copied as-is for HomeKit target? */
    canRemuxAudio?: boolean;
}

/** Raw bitstream analysis result from ffprobe. */
export interface RawStreamInfo {
    video?: {
        rawCodec: string;
        normalizedCodec: string;
        displayCodec: string;
        profile?: string;
        level?: string;
        width: number;
        height: number;
        fps?: number;
        bitrate?: number;
        pixFmt?: string;
        colorSpace?: string;
        colorTransfer?: string;
        colorPrimaries?: string;
        verifiedFromBitstream: boolean;
    };
    audio?: {
        rawCodec: string;
        normalizedCodec: string;
        displayCodec: string;
        sampleRate: number;
        channels: number;
        bitrate?: number;
        verifiedFromBitstream: boolean;
    };
    transport: 'tcp' | 'udp';
    hasVideo: boolean;
    hasAudio: boolean;
}

export interface CameraCapabilities {
    discoveryStatus: DiscoveryStatus;
    source: 'onvif' | 'rtsp' | 'integration' | 'manual';
    lastCheckedAt?: string;
    manufacturer?: string;
    model?: string;
    firmware?: string;
    serialNumber?: string;
    /** Entity names explicitly advertised by the camera/integration. */
    detectedEntities?: string[];
    /** Structured evidence per capability — never inferred, always sourced. */
    capabilityEvidence?: CapabilityEvidence[];
    video: { profiles: StreamProfile[]; selectedProfileId?: string; supportsH264: boolean; supportsH265: boolean; supportsTranscoding: boolean };
    audio: { available: boolean; input: boolean; output: boolean; codecs: string[]; selectedCodec?: string; sampleRates: number[] };
    controls: { ptz: boolean; light: boolean; lightControl: boolean; microphone: boolean; speaker: boolean; twoWayAudio: boolean; siren: boolean; sirenControl: boolean; motionEvents: boolean };
    preview: { snapshot: boolean; rtsp: boolean; mjpeg: boolean; webrtc: boolean; hls: boolean };
    yolo: { available: boolean; reason?: string };
    matter: { available: boolean; published: boolean; commissioned: boolean; supportsMatterRemux: boolean; reason?: string };
    /** Human-readable ONVIF connection note when ONVIF succeeded but RTSP failed. */
    onvifConnected?: boolean;
    onvifRtspFailureReason?: string;
}

export interface CameraDiscoveryResult {
    capabilities: CameraCapabilities;
    streamProfiles?: StreamProfile[];
}

export interface ConnectionTestResult { success: boolean; status: DiscoveryStatus; message?: string; }
export interface PreviewSession { sessionId: string; url?: string; expiresAt?: string; }

export interface CameraAdapter {
    readonly protocol: CameraProtocol;
    discover(input: CameraConnectionInput): Promise<CameraDiscoveryResult>;
    getCapabilities(input: CameraConnectionInput): Promise<CameraCapabilities>;
    getSnapshot?(input: CameraConnectionInput): Promise<Buffer>;
    executeAction?(input: CameraConnectionInput, action: 'light' | 'siren' | 'relay', state: boolean, evidence?: CapabilityEvidence): Promise<void>;
    getStreamProfiles?(input: CameraConnectionInput): Promise<StreamProfile[]>;
    testConnection(input: CameraConnectionInput): Promise<ConnectionTestResult>;
    startPreview?(input: CameraConnectionInput): Promise<PreviewSession>;
    stopPreview?(sessionId: string): Promise<void>;
}

/**
 * Normalize a raw RTSP URI and inject credentials safely.
 *
 * Rules:
 * - NEVER apply encodeURIComponent before assigning to URL.username / URL.password.
 *   The URL class encodes those fields automatically. Double-encoding breaks FFmpeg.
 * - Do NOT overwrite credentials that are already embedded in the URI.
 * - Replace localhost / 0.0.0.0 with the camera's real IP if provided.
 * - Log host correction without exposing secrets.
 */
export function cameraStreamUrl(input: { ip?: string; username?: string; password?: string }, rawUrl: string): string {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`URI RTSP malformada: "${redactCameraSecrets(rawUrl)}"`);
    }

    // Fix cameras that report localhost or 0.0.0.0 — replace with real IP
    const reportedHost = url.hostname;
    if ((reportedHost === 'localhost' || reportedHost === '127.0.0.1' || reportedHost === '0.0.0.0') && input.ip) {
        console.log(`[rtsp-url] Corrigiendo host de cámara: ${reportedHost} → ${input.ip}`);
        url.hostname = input.ip;
    }

    // Only inject credentials when the URI carries no auth at all.
    // ONVIF URIs frequently embed session tokens in the path; do not overwrite.
    // IMPORTANT: assign directly to url.username / url.password — the URL class
    // encodes automatically. Using encodeURIComponent first causes double-encoding
    // which breaks FFmpeg (e.g. '%40' becomes '%2540').
    const hasAuth = url.username || url.password;
    if (!hasAuth) {
        if (input.username) url.username = input.username;
        if (input.password) url.password = input.password;
    }

    return url.toString();
}

/**
 * Classify an ffprobe/ffmpeg stderr message into a structured error category.
 */
export function classifyMediaError(stderr: string, exitCode: number | null): MediaErrorCategory {
    const s = stderr.toLowerCase();
    if (s === 'aborted' || s.includes('aborted')) return 'cancelled';
    if (s.includes('no route to host') || s.includes('name or service not known') || s.includes('getaddrinfo')) return 'dns_error';
    if (s.includes('connection refused')) return 'connection_refused';
    if (s.includes('timed out') || s.includes('timeout') || exitCode === null) return 'connection_timeout';
    if (s.includes('401') || s.includes('unauthorized') || s.includes('authentication')) return 'authentication_failed';
    if (s.includes('403') || s.includes('forbidden')) return 'authentication_failed';
    if (s.includes('404') || s.includes('not found')) return 'rtsp_404';
    if (s.includes('454')) return 'rtsp_454_session_not_found';
    if (s.includes('461')) return 'rtsp_461_transport_unsupported';
    if (s.includes('invalid data found')) return 'invalid_media';
    if (s.includes('no video stream') || s.includes('no streams')) return 'no_video_stream';
    if (s.includes('decoder') || s.includes('codec not found')) return 'unsupported_codec';
    if (s.includes('failed to spawn') || s.includes('enoent')) return 'process_spawn_failed';
    if (s.includes('malformed') || s.includes('invalid url')) return 'malformed_uri';
    return 'unknown';
}

/** @deprecated Use classifyMediaError */
export const classifyRtspError = classifyMediaError;

/**
 * Normalize raw codec names from ffprobe to canonical names.
 */
export function normalizeCodec(rawCodec: string): { normalizedCodec: string; displayCodec: string } {
    const c = rawCodec.toLowerCase();
    if (c === 'h264' || c === 'avc1' || c === 'avc') return { normalizedCodec: 'H264', displayCodec: 'H.264 / AVC' };
    if (c === 'hevc' || c === 'h265' || c === 'hev1' || c === 'hvc1') return { normalizedCodec: 'H265', displayCodec: 'H.265 / HEVC' };
    if (c === 'aac') return { normalizedCodec: 'AAC', displayCodec: 'AAC' };
    if (c === 'opus') return { normalizedCodec: 'OPUS', displayCodec: 'Opus' };
    if (c === 'pcm_mulaw' || c === 'pcmu') return { normalizedCodec: 'G711U', displayCodec: 'G.711 μ-law' };
    if (c === 'pcm_alaw' || c === 'pcma') return { normalizedCodec: 'G711A', displayCodec: 'G.711 A-law' };
    if (c === 'mjpeg') return { normalizedCodec: 'MJPEG', displayCodec: 'M-JPEG' };
    return { normalizedCodec: rawCodec.toUpperCase(), displayCodec: rawCodec.toUpperCase() };
}

/** Redact RTSP credentials and tokens from any log message or URL string. */
export function redactCameraSecrets(message: string): string {
    return message.replace(/(https?|rtsps?):\/\/[^\s"']+/gi, (match) => {
        try {
            const u = new URL(match);
            if (u.username || u.password) {
                u.username = '***';
                u.password = '';
            }
            // Limpia los queries sensibles
            const params = new URLSearchParams(u.search);
            for (const key of Array.from(params.keys())) {
                if (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('pass')) {
                    params.set(key, '***');
                }
            }
            u.search = params.toString();
            // Evitar trailing slash extraño si no lo tenía original
            return u.toString();
        } catch {
            return match.replace(/:\/\/(?:[^@/]+)@/, '://***@');
        }
    });
}

export function emptyCapabilities(source: CameraCapabilities['source']): CameraCapabilities {
    return {
        discoveryStatus: 'pending', source,
        video: { profiles: [], supportsH264: false, supportsH265: false, supportsTranscoding: false },
        audio: { available: false, input: false, output: false, codecs: [], sampleRates: [] },
        controls: { ptz: false, light: false, lightControl: false, microphone: false, speaker: false, twoWayAudio: false, siren: false, sirenControl: false, motionEvents: false },
        preview: { snapshot: false, rtsp: false, mjpeg: false, webrtc: false, hls: false },
        yolo: { available: false, reason: 'No hay un runtime YOLO configurado' },
        matter: { available: false, published: false, commissioned: false, supportsMatterRemux: false, reason: 'Matterbridge no está conectado' },
        capabilityEvidence: [],
    };
}
