import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiUrl } from '../../lib/ingress-url';

interface WebRTCPlayerProps {
    cameraId: string;
    onError?: (err: Error) => void;
    onClose?: () => void;
}

type PlayerStatus =
    | 'Estableciendo WebRTC'
    | 'Negociando SDP'
    | 'Conectando ICE'
    | 'Recibiendo RTP'
    | 'Esperando primer frame'
    | 'Reproduciendo'
    | 'failed';

export function WebRTCPlayer({ cameraId, onError, onClose }: WebRTCPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const sessionIdRef = useRef<string>('');
    const [status, setStatus] = useState<PlayerStatus>('Estableciendo WebRTC');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const frameNotifiedRef = useRef(false);

    const cleanup = useCallback(async () => {
        const sid = sessionIdRef.current;
        if (sid) {
            fetch(apiUrl(`/api/scrypted/devices/${cameraId}/webrtc/${sid}`), {
                method: 'DELETE',
                credentials: 'same-origin',
                keepalive: true,
            }).catch(() => {});
            sessionIdRef.current = '';
        }
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
    }, [cameraId]);

    const handleError = useCallback((msg: string) => {
        setStatus('failed');
        setErrorMsg(msg);
        cleanup();
        if (onError) onError(new Error(msg));
    }, [cleanup, onError]);

    useEffect(() => {
        let cancelled = false;
        frameNotifiedRef.current = false;

        let frameTimeout: any = null;
        let heartbeatInterval: any = null;
        const onFrame = () => {
            if (frameNotifiedRef.current) return;
            frameNotifiedRef.current = true;
            if (frameTimeout) clearTimeout(frameTimeout);
            setStatus('Reproduciendo');
        };

        const vid = videoRef.current;
        if (vid) {
            vid.addEventListener('loadeddata', onFrame, { once: true });
            vid.addEventListener('playing', onFrame, { once: true });
        }

        const start = async () => {
            setStatus('Negociando SDP');
            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            pc.addTransceiver('video', { direction: 'recvonly' });

            pc.ontrack = (event) => {
                if (videoRef.current && event.streams[0]) {
                    videoRef.current.srcObject = event.streams[0];
                }
            };

            pc.oniceconnectionstatechange = () => {
                if (cancelled) return;
                const s = pc.iceConnectionState;
                if (s === 'checking') setStatus('Conectando ICE');
                else if (s === 'connected' || s === 'completed') setStatus('Recibiendo RTP');
                else if (s === 'failed') handleError('ICE fallido: no se pudo establecer conexión con el Runtime.');
                else if (s === 'disconnected') handleError('Conexión ICE interrumpida.');
            };

            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                const res = await fetch(apiUrl(`/api/scrypted/devices/${cameraId}/webrtc/negotiate`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ offer: offer.sdp }),
                });

                if (cancelled) return;

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    handleError(data.error || `Error del servidor: HTTP ${res.status}`);
                    return;
                }

                const data = await res.json();
                if (data.error) { handleError(data.error); return; }

                sessionIdRef.current = data.sessionId;

                // Iniciar heartbeat cada 20 segundos
                heartbeatInterval = setInterval(async () => {
                    const sid = sessionIdRef.current;
                    if (!sid || cancelled) return;
                    try {
                        await fetch(apiUrl(`/api/scrypted/devices/${cameraId}/webrtc/${sid}/heartbeat`), {
                            method: 'POST',
                            credentials: 'same-origin',
                        });
                    } catch (e) {
                        console.warn('[WebRTCPlayer] Heartbeat request failed:', e);
                    }
                }, 20000);

                await pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
                setStatus('Conectando ICE');

                // Watchdog para el primer frame (15 segundos a partir de setRemoteDescription)
                frameTimeout = setTimeout(() => {
                    if (!frameNotifiedRef.current && !cancelled) {
                        handleError('Timeout: Conexión establecida pero no se recibió el primer frame tras 15 segundos.');
                    }
                }, 15000);

            } catch (err: any) {
                if (!cancelled) handleError(err.message ?? 'Error inesperado al iniciar WebRTC.');
            }
        };

        start();

        return () => {
            cancelled = true;
            if (frameTimeout) clearTimeout(frameTimeout);
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            if (vid) {
                vid.removeEventListener('loadeddata', onFrame);
                vid.removeEventListener('playing', onFrame);
            }
            cleanup();
        };
    }, [cameraId, cleanup, handleError]);

    return (
        <div className="relative w-full h-full bg-black flex items-center justify-center">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
            />
            {status !== 'Reproduciendo' && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 p-4 text-center">
                    {status === 'failed' ? (
                        <>
                            <div className="text-red-400 font-bold text-sm">Error WebRTC</div>
                            <div className="text-red-200 text-xs max-w-xs leading-relaxed">{errorMsg}</div>
                            {onClose && (
                                <button
                                    onClick={() => onClose()}
                                    className="mt-2 text-xs text-gray-400 underline hover:text-white"
                                >
                                    Cerrar
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <div className="text-xs text-white/80 font-semibold uppercase tracking-wide">{status}</div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

