import { useState, useEffect } from 'react';

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
    decoders: Record<string, boolean>;
    encoders: Record<string, boolean>;
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
    capabilities: MediaCapabilities;
}

export function useMediaCapabilities() {
    const [response, setResponse] = useState<SystemCapabilitiesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCapabilities = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/system/media-capabilities');
            if (res.status === 401) return;
            if (!res.ok) throw new Error(`Error: ${res.status} ${res.statusText}`);
            const data: SystemCapabilitiesResponse = await res.json();
            setResponse(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const refreshCapabilities = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/system/media-capabilities/refresh', { method: 'POST' });
            if (!res.ok) throw new Error(`Error: ${res.status} ${res.statusText}`);
            const data: SystemCapabilitiesResponse = await res.json();
            setResponse(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCapabilities();
        
        const interval = setInterval(() => {
            if (response?.status === 'checking') {
                fetchCapabilities();
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [response?.status]);

    return { 
        response, 
        capabilities: response?.status === 'checking' && response.lastSuccessfulCheck ? response.lastSuccessfulCheck.result : response?.capabilities,
        loading, 
        error, 
        refreshCapabilities 
    };
}
