import { CapabilityEvidence } from '../capabilities/capability-evidence';
import { ResolvedAuthorization } from './credential-store';
import { StreamProfile } from '../cameras/camera-adapter';

export type MediaTransport = 'tcp' | 'udp' | 'http' | 'https' | 'hls' | 'webrtc' | 'pipe' | 'buffer';
export type MediaSourceType = 'rtsp' | 'onvif' | 'hls' | 'http' | 'webrtc' | 'plugin_buffer' | 'plugin_pipe';

/**
 * Opaque reference keys. All must be resolved by the SessionManager/ConnectionSecretStore.
 * MediaSourceDescriptor MUST NOT contain raw URLs with credentials, tokens, or passwords.
 */
export interface MediaSourceDescriptor {
    id: string;                        // Stable internal ID for this source
    sourceType: MediaSourceType;
    transport: MediaTransport;
    deviceId: string;

    /** Opaque reference keys — secrets resolved only inside the backend */
    sourceLocatorRef?: string;         // Opaque ref to resolve the base URI (e.g. deviceId for RTSP/ONVIF)
    credentialRef?: string;            // Opaque ref for ConnectionSecretStore.resolveAuthorization()
    authorizationRef?: string;         // Alternative: for Bearer/Header auth
    providerSessionRef?: string;       // For plugins managing their own session lifecycle

    /** ONVIF profile token (not a secret) */
    profile?: string;
    profileName?: string;

    /** Plugin origin */
    pluginId?: string;

    /** Optional: expiration timestamp (ms). SessionManager will refresh before this. */
    expirationMs?: number;
}

/**
 * Result of discovering/listing sources for a device.
 */
export interface MediaSourceDiscoveryResult {
    available: boolean;
    sources: MediaSourceDescriptor[];
    reason?: string;
    checkedAt: string;
}

/**
 * A probed media source: pairs the descriptor with the validated stream profile.
 */
export interface ProbedMediaSource {
    descriptor: MediaSourceDescriptor;
    profile: StreamProfile;
    probeSucceeded: boolean;
    probeErrorCategory?: string;
    probeDurationMs?: number;
}

export interface CameraMediaProvider {
    getMediaSources(deviceId: string, signal?: AbortSignal): Promise<MediaSourceDiscoveryResult>;
    refreshMediaSource?(deviceId: string, sourceId: string, signal?: AbortSignal): Promise<MediaSourceDescriptor>;
}

export interface DeviceControlProvider {
    listCapabilities(deviceId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]>;
    readCapability?(deviceId: string, capabilityId: string, signal?: AbortSignal): Promise<unknown>;
    executeCapability?(deviceId: string, capabilityId: string, payload: unknown, signal?: AbortSignal): Promise<void>;
}

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
    | 'not_retryable'
    | 'unknown';

/**
 * Typed error for media operations, to support retry logic without string parsing.
 */
export class MediaOperationError extends Error {
    constructor(
        message: string,
        public readonly category: MediaErrorCategory,
        public readonly isIdempotent: boolean = false,
        public readonly statusCode?: number
    ) {
        super(message);
        this.name = 'MediaOperationError';
    }
}
