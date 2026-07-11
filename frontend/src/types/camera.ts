// Shared types between frontend and the BFF layer.
// Keep these in sync with server/src/api/camera-service.ts

export type CameraProtocol = 'RTSP' | 'ONVIF' | 'OTHER';
export type CameraStatus   = 'online' | 'offline' | 'unknown';
export type DiscoveryStatus = 'pending' | 'discovering' | 'online' | 'offline' | 'authentication_failed' | 'unsupported' | 'error';
export interface StreamProfile { id: string; name?: string; codec?: string; width?: number; height?: number; fps?: number; bitrate?: number; streamUri?: string; snapshotUri?: string; }
export interface CameraCapabilities {
    discoveryStatus: DiscoveryStatus; source: 'onvif' | 'rtsp' | 'integration' | 'manual'; lastCheckedAt?: string; manufacturer?: string; model?: string; firmware?: string; serialNumber?: string; detectedEntities?: string[];
    video: { profiles: StreamProfile[]; selectedProfileId?: string; supportsH264: boolean; supportsH265: boolean; supportsTranscoding: boolean };
    audio: { available: boolean; input: boolean; output: boolean; codecs: string[]; selectedCodec?: string; sampleRates: number[] };
    controls: { ptz: boolean; light: boolean; lightControl: boolean; microphone: boolean; speaker: boolean; twoWayAudio: boolean; siren: boolean; sirenControl: boolean; motionEvents: boolean };
    preview: { snapshot: boolean; rtsp: boolean; mjpeg: boolean; webrtc: boolean; hls: boolean }; yolo: { available: boolean; reason?: string }; matter: { available: boolean; published: boolean; commissioned: boolean; reason?: string };
}

export interface Camera {
    id: string;
    name: string;
    plugin: string;
    manufacturer?: string;
    model?: string;
    interfaces: string[];
    capabilities: string[];
    diagnostics?: { status: 'online' | 'offline' | 'unknown' | 'healthy' | 'warning' | 'critical' };
    ip?: string; // fallback
    port?: number; // fallback
    config: Record<string, unknown>;
    
    // HKSV Specifics
    hksv_codecs?: string[];
    hksv_video_tiers?: Record<string, unknown>;
    hksv_audio_codec?: string;
    hksv_audio_samplerate?: number;
    hksv_capabilities?: Record<string, unknown>;
    hksv_motion_zones?: Record<string, unknown>;
    // Matter Configuration
    matter_vendor_id?: number;
    matter_product_id?: number;
    matter_device_name?: string;

    created_at: string;  // ISO string from JSON
    updated_at: string;
    adapter_type?: CameraProtocol;
    discovery_status?: DiscoveryStatus;
    capabilities?: CameraCapabilities;
    stream_profiles?: StreamProfile[];
    last_probe_at?: string;
    last_error?: string;
}

export interface CameraEvent {
    id: string;
    camera_id: string;
    event_type: 'motion' | 'person' | 'car' | 'animal' | 'online' | 'offline' | 'error';
    timestamp: string;
    metadata: Record<string, unknown>;
}

export interface CreateCameraInput {
    id: string;
    name: string;
    plugin: string; // was protocol
    manufacturer?: string;
    model?: string;
    interfaces: string[];
    capabilities: string[];
    diagnostics?: { status: 'online' | 'offline' | 'unknown' | 'healthy' | 'warning' | 'critical' };
    ip?: string; // fallback
    port?: number; // fallback
    config?: Record<string, unknown>;
    
    // HKSV Specifics
    hksv_codecs?: string[];
    hksv_video_tiers?: Record<string, unknown>;
    hksv_audio_codec?: string;
    hksv_audio_samplerate?: number;
    hksv_capabilities?: Record<string, unknown>;
    hksv_motion_zones?: Record<string, unknown>;

    // Matter Configuration
    matter_vendor_id?: number;
    matter_product_id?: number;
    matter_device_name?: string;
}

// WebSocket event types
export type WsMessageType = 'camera_event' | 'camera_list_updated' | 'pong' | 'error';

export interface WsServerMessage {
    type: WsMessageType;
    payload: unknown;
}
