export type CapabilityConfidence = 'verified' | 'anunciado' | 'inferido' | 'desconocido';
export type EntityType = 'video' | 'stream_audio' | 'microphone' | 'speaker' | 'talkback' | 'light' | 'siren' | 'ptz' | 'motion' | 'person' | 'vehicle' | 'package' | 'doorbell' | 'battery' | 'temperature' | 'relay' | 'digital_input';
export type EntitySource = 'rtsp' | 'onvif-device' | 'onvif-media' | 'onvif-media2' | 'onvif-deviceio' | 'onvif-imaging' | 'onvif-events' | 'onvif-analytics' | 'vendor-local-api' | 'vendor-cloud-api' | 'home-assistant' | 'user-mapped' | 'plugin';

export interface CapabilityEvidence {
    entity: EntityType;
    detected: boolean;
    verified: boolean;
    readable: boolean;
    controllable: boolean;
    source: EntitySource;
    confidence: CapabilityConfidence;
    operation?: string;
    evidence?: Record<string, unknown>;
    lastVerifiedAt?: string;
    error?: { category: string; message: string };
}
