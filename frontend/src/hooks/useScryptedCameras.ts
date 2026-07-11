import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera, CameraEvent, CreateCameraInput, WsServerMessage } from '../types/camera';
import { apiUrl, websocketUrl } from '../lib/ingress-url';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseCamerasReturn {
    cameras: Camera[];
    loading: boolean;
    connectionState: ConnectionState;
    error: string | null;
    recentEvents: CameraEvent[];
    addCamera: (input: CreateCameraInput) => Promise<Camera>;
    deleteCamera: (id: string) => Promise<void>;
    refetch: () => Promise<void>;
}

const WS_RECONNECT_DELAY   = 3000;
const WS_MAX_DELAY         = 30000;
const WS_MAX_ATTEMPTS      = 5;   // give up WebSocket after 5 failures
const API_BASE             = '/api/scrypted/devices';

export function useScryptedCameras(): UseCamerasReturn {
    const [cameras, setCameras]               = useState<Camera[]>([]);
    const [loading, setLoading]               = useState(true);
    const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
    const [error, setError]                   = useState<string | null>(null);
    const [recentEvents, setRecentEvents]     = useState<CameraEvent[]>([]);

    const wsRef           = useRef<WebSocket | null>(null);
    const reconnectDelay  = useRef(WS_RECONNECT_DELAY);
    const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMounted       = useRef(true);
    const wsAttempts      = useRef(0);

    // ── REST: fetch full camera list ──────────────────────────────────────────
    const fetchCameras = useCallback(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        try {
            const url = apiUrl(API_BASE);
            const res = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data = await res.json() as { devices: Camera[] };
            if (isMounted.current) {
                setCameras(data.devices);
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

    // ── REST: add camera ──────────────────────────────────────────────────────
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

    // ── REST: delete camera ───────────────────────────────────────────────────
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

    // ── WebSocket: real-time events ───────────────────────────────────────────
    const connectWs = useCallback(() => {
        if (!isMounted.current) return;

        const url = websocketUrl('api/ws/cameras');
        console.info('[WS] Connecting:', url);

        setConnectionState('connecting');
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!isMounted.current) return;
            reconnectDelay.current = WS_RECONNECT_DELAY;  // reset backoff
            setConnectionState('connected');
            // Subscribe to all camera events
            ws.send(JSON.stringify({ type: 'subscribe', camera_id: '*' }));
        };

        ws.onmessage = (evt) => {
            if (!isMounted.current) return;
            try {
                const msg = JSON.parse(evt.data) as WsServerMessage;
                if (msg.type === 'camera_event') {
                    const event = msg.payload as CameraEvent;
                    setRecentEvents(prev => [event, ...prev].slice(0, 100));
                    // Update camera status in-place for online/offline events
                    if (event.event_type === 'online' || event.event_type === 'offline') {
                        setCameras(prev =>
                            prev.map(c =>
                                c.id === event.camera_id
                                    ? { ...c, status: event.event_type as Camera['status'] }
                                    : c
                            )
                        );
                    }
                } else if (msg.type === 'camera_list_updated' || (msg.type as string) === 'cameras.updated') {
                    // Server notified us a camera was added/removed/updated — re-fetch
                    fetchCameras();
                }
            } catch {
                // ignore parse errors
            }
        };

        ws.onclose = () => {
            if (!isMounted.current) return;
            wsAttempts.current += 1;
            if (wsAttempts.current >= WS_MAX_ATTEMPTS) {
                // Give up WebSocket — REST data is still shown
                setConnectionState('error');
                return;
            }
            setConnectionState('reconnecting');
            reconnectTimer.current = setTimeout(() => {
                reconnectDelay.current = Math.min(reconnectDelay.current * 2, WS_MAX_DELAY);
                connectWs();
            }, reconnectDelay.current);
        };

        ws.onerror = () => {
            ws.close();  // triggers onclose and the reconnect logic
        };
    }, [fetchCameras]);

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    useEffect(() => {
        isMounted.current = true;
        fetchCameras();
        connectWs();

        return () => {
            isMounted.current = false;
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            wsRef.current?.close();
        };
    }, [fetchCameras, connectWs]);

    // Keepalive ping every 30s to prevent proxy timeouts
    useEffect(() => {
        const ping = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30_000);
        return () => clearInterval(ping);
    }, []);

    return {
        cameras,
        loading,
        connectionState,
        error,
        recentEvents,
        addCamera,
        deleteCamera,
        refetch: fetchCameras,
    };
}
