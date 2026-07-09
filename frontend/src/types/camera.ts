// Shared types between frontend and the BFF layer.
// Keep these in sync with server/src/api/camera-service.ts

export type CameraProtocol = 'RTSP' | 'ONVIF';
export type CameraStatus   = 'online' | 'offline' | 'unknown';

export interface Camera {
    id: string;
    name: string;
    ip: string;
    port: number;
    rtsp_url?: string;
    onvif_port?: number;
    username?: string;
    protocol: CameraProtocol;
    status: CameraStatus;
    codec?: string;
    config: Record<string, unknown>;
    created_at: string;  // ISO string from JSON
    updated_at: string;
}

export interface CameraEvent {
    id: string;
    camera_id: string;
    event_type: 'motion' | 'person' | 'car' | 'animal' | 'online' | 'offline' | 'error';
    timestamp: string;
    metadata: Record<string, unknown>;
}

export interface CreateCameraInput {
    name: string;
    ip: string;
    port: number;
    rtsp_url?: string;
    onvif_port?: number;
    username?: string;
    password?: string;
    protocol: CameraProtocol;
    codec?: string;
}

// WebSocket event types
export type WsMessageType = 'camera_event' | 'camera_list_updated' | 'pong' | 'error';

export interface WsServerMessage {
    type: WsMessageType;
    payload: unknown;
}
