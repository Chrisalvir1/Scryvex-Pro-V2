import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera, CameraEvent, CreateCameraInput, WsServerMessage } from '../types/camera';
import { apiUrl, websocketUrl } from '../lib/ingress-url';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseScryvexCamerasReturn {
    cameras: Camera[];
    loading: boolean;
    connectionState: ConnectionState;
    error: string | null;
    recentEvents: CameraEvent[];
    addCamera: (input: CreateCameraInput) => Promise<Camera>;
    updateCamera: (id: string, input: Partial<CreateCameraInput>) => Promise<Camera>;
    deleteCamera: (id: string) => Promise<void>;
    refetch: () => Promise<void>;
}

const WS_RECONNECT_DELAY   = 3000;
const WS_MAX_DELAY         = 30000;
const WS_MAX_ATTEMPTS      = 5;
const API_BASE             = '/api/cameras';

export function useScryvexCameras(): UseScryvexCamerasReturn {
    const [cameras, setCameras]                 = useState<Camera[]>([]);
    const [loading, setLoading]                 = useState(true);
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const [error, setError]                     = useState<string | null>(null);
    const [recentEvents, setRecentEvents]       = useState<CameraEvent[]>([]);

    const wsRef           = useRef<WebSocket | null>(null);
    const reconnectDelay  = useRef(WS_RECONNECT_DELAY);
    const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMounted       = useRef(true);
    const wsAttempts      = useRef(0);

    const fetchCameras = useCallback(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
            const url = apiUrl(API_BASE);
            const res = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json() as { cameras: Camera[] };
            if (isMounted.current) {
                setCameras(data.cameras);
                setError(null);
            }
        } catch (err: unknown) {
            clearTimeout(timeoutId);
            const msg = err instanceof Error ? err.message : String(err);
            if (isMounted.current) {
                if (msg.includes('aborted') || msg.includes('timeout')) {
                    setError('Timeout al conectar con el servidor (5s).');
                } else {
                    setError(msg);
                }
            }
        } finally {
            if (isMounted.current) setLoading(false);
        }
    }, []);

    const addCamera = useCallback(async (input: CreateCameraInput): Promise<Camera> => {
        const res = await fetch(apiUrl(API_BASE), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(input),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { camera: Camera };
        if (isMounted.current) {
            setCameras(prev => [...prev, data.camera]);
        }
        return data.camera;
    }, []);

    const updateCamera = useCallback(async (id: string, input: Partial<CreateCameraInput>): Promise<Camera> => {
        const res = await fetch(apiUrl(`${API_BASE}/${id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(input),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { camera: Camera };
        if (isMounted.current) {
            setCameras(prev => prev.map(c => c.id === id ? data.camera : c));
        }
        return data.camera;
    }, []);

    const deleteCamera = useCallback(async (id: string): Promise<void> => {
        const res = await fetch(apiUrl(`${API_BASE}/${id}`), { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        if (isMounted.current) {
            setCameras(prev => prev.filter(c => c.id !== id));
        }
    }, []);

    const connectWs = useCallback(() => {
        if (!isMounted.current) return;
        if (wsAttempts.current >= WS_MAX_ATTEMPTS) {
            setConnectionState('error');
            return;
        }

        try {
            const ws = new WebSocket(websocketUrl('/api/ws/cameras'));
            wsRef.current = ws;

            ws.onopen = () => {
                if (!isMounted.current) return;
                setConnectionState('connected');
                reconnectDelay.current = WS_RECONNECT_DELAY;
                wsAttempts.current = 0;
            };

            ws.onmessage = (event) => {
                if (!isMounted.current) return;
                try {
                    const msg = JSON.parse(event.data) as WsServerMessage;
                    if (msg.type === 'camera.created' || msg.type === 'camera.updated' || msg.type === 'camera.deleted') {
                        void fetchCameras();
                    } else if (msg.type === 'camera.event') {
                        setRecentEvents(prev => [msg.data as CameraEvent, ...prev].slice(0, 50));
                    }
                } catch (err) {
                    console.error('[WS] Parse error', err);
                }
            };

            ws.onclose = () => {
                if (!isMounted.current) return;
                wsRef.current = null;
                setConnectionState('reconnecting');
                wsAttempts.current++;
                reconnectTimer.current = setTimeout(connectWs, reconnectDelay.current);
                reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, WS_MAX_DELAY);
            };

            ws.onerror = () => {
                // ws.onclose will handle reconnect logic
            };
        } catch (err) {
            console.error('[WS] Connection error', err);
            setConnectionState('error');
        }
    }, [fetchCameras]);

    useEffect(() => {
        isMounted.current = true;
        void fetchCameras();
        connectWs();

        return () => {
            isMounted.current = false;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, [connectWs, fetchCameras]);

    return {
        cameras,
        loading,
        connectionState,
        error,
        recentEvents,
        addCamera,
        updateCamera,
        deleteCamera,
        refetch: fetchCameras,
    };
}
