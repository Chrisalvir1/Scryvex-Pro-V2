import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { apiUrl } from '../lib/ingress-url';

interface Props {
    cameraId: string;
    hasAudio: boolean;
    onSnapshotFallback: (error: string) => void;
}

export function HlsPlayer({ cameraId, hasAudio, onSnapshotFallback }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [muted, setMuted] = useState(true);
    const [loading, setLoading] = useState(true);
    const [_error, setError] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const hlsRef = useRef<Hls | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let mounted = true;
        const ac = new AbortController();

        const startSession = async () => {
            try {
                setLoading(true);
                setError(null);
                
                const res = await fetch(apiUrl(`api/cameras/${cameraId}/preview/hls/sessions`), {
                    method: 'POST',
                    signal: ac.signal
                });
                
                if (!mounted) return;
                
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || `HTTP ${res.status}`);
                }
                
                const data = await res.json();
                setSessionId(data.sessionId);
                
                // Start heartbeat
                if (heartbeatRef.current) clearInterval(heartbeatRef.current);
                heartbeatRef.current = setInterval(() => {
                    fetch(apiUrl(`api/cameras/${cameraId}/preview/hls/${data.sessionId}/heartbeat`), { method: 'POST' }).catch(() => {});
                }, 10000);

            } catch (err: any) {
                if (!mounted || err.name === 'AbortError') return;
                console.error('HLS Start Error:', err);
                
                if (retryCount < 1) {
                    setRetryCount(c => c + 1);
                } else {
                    onSnapshotFallback(err.message || 'Falló la conexión HLS');
                }
            }
        };

        startSession();

        return () => {
            mounted = false;
            ac.abort();
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            if (sessionId) {
                // Background delete
                fetch(apiUrl(`api/cameras/${cameraId}/preview/hls/${sessionId}`), { method: 'DELETE', keepalive: true }).catch(() => {});
            }
        };
    }, [cameraId, retryCount, onSnapshotFallback, sessionId]);

    useEffect(() => {
        if (!sessionId || !videoRef.current) return;

        const video = videoRef.current;
        const streamUrl = apiUrl(`api/cameras/${cameraId}/preview/hls/${sessionId}/index.m3u8`);

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                setLoading(false);
                video.play().catch(e => console.error('Auto-play prevent', e));
            });
            video.addEventListener('error', () => {
                if (retryCount < 1) setRetryCount(c => c + 1);
                else onSnapshotFallback('Native HLS Error');
            });
        } else if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90,
                maxBufferLength: 30,
            });
            hlsRef.current = hls;
            
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                setLoading(false);
                video.play().catch(e => console.error('Auto-play prevent', e));
            });
            
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            if (retryCount < 1) setRetryCount(c => c + 1);
                            else onSnapshotFallback(`HLS.js Fatal Error: ${data.details}`);
                            break;
                    }
                }
            });
        } else {
            onSnapshotFallback('HLS no es soportado por este navegador');
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            video.removeAttribute('src');
            video.load();
        };
    }, [sessionId, cameraId, retryCount, onSnapshotFallback]);

    return (
        <div className="relative w-full h-full bg-black flex items-center justify-center">
            {loading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-3" />
                    <span className="text-sm text-gray-400 font-mono">Iniciando HLS Stream...</span>
                </div>
            )}
            
            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                autoPlay
                playsInline
                muted={muted}
            />

            {/* Audio Toggle */}
            {hasAudio && !loading && (
                <button
                    onClick={() => setMuted(!muted)}
                    className="absolute bottom-4 right-4 z-20 p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-full text-white transition-all border border-white/10"
                >
                    {muted ? '🔇' : '🔊'}
                </button>
            )}
        </div>
    );
}
