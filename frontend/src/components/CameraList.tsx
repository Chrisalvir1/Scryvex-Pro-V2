import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Camera, CameraEvent } from '../types/camera';

interface Props {
    cameras: Camera[];
    events: CameraEvent[];
    onDelete: (id: string) => Promise<void>;
}

const STATUS_COLORS: Record<Camera['status'], string> = {
    online:  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    offline: 'bg-red-500/20 text-red-400 border border-red-500/30',
    unknown: 'bg-gray-500/20 text-gray-400 border border-gray-500/30',
};

const STATUS_LABELS: Record<string, string> = {
    online: 'ONLINE',
    offline: 'OFFLINE',
    unknown: 'DESCONOCIDO',
};

type ActiveTab = 'preview' | 'logs' | 'info' | 'matter' | 'sensors';

const BRAND_LOGOS: Record<string, string> = {
    ring: '/logos/ring.png',
    wyze: '/logos/wyze.png',
    tapo: '/logos/tapo.jpg',
    'tp-link': '/logos/tapo.jpg',
    tuya: '/logos/tuya.png',
    ezviz: '/logos/ezviz.png',
    hikvision: '/logos/hikvision.png',
    reolink: '/logos/reolink.png',
    dahua: '/logos/dahua.png',
    google: '/logos/google-nest.png',
    nest: '/logos/google-nest.png',
    arlo: '/logos/arlo.png',
    vimtag: '/logos/vimtag.png',
    rtsp: '/logos/rtsp.png',
    onvif: '/logos/onvif.png',
};

// Helper to determine the camera brand logo based on its name
function getBrandLogo(name: string): string {
    const n = name.toLowerCase();
    for (const [key, logo] of Object.entries(BRAND_LOGOS)) {
        if (n.includes(key)) {
            return logo;
        }
    }
    // Generic fallback icon if no brand is matched
    return '';
}

export function CameraList({ cameras, events, onDelete }: Props) {
    const [selectedId, setSelectedId]     = useState<string | null>(cameras[0]?.id ?? null);
    const [activeTab, setActiveTab]       = useState<ActiveTab>('preview');
    const [deletingId, setDeletingId]     = useState<string | null>(null);
    const [deleteError, setDeleteError]   = useState<string | null>(null);

    // Stream Controls State
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [micActive, setMicActive] = useState(false);
    const [lightActive, setLightActive] = useState(false);
    const [sirenActive, setSirenActive] = useState(false);
    const [streamLoading, setStreamLoading] = useState(false);

    // Codec Probe State
    const [probeData, setProbeData] = useState<any>(null);
    const [probeLoading, setProbeLoading] = useState(false);

    // Matter Pairing State
    const [matterStatus, setMatterStatus] = useState<any>(null);
    const [matterPairing, setMatterPairing] = useState<any>(null);
    const [matterCountdown, setMatterCountdown] = useState<number>(0);

    // Reset stream state when camera changes
    useEffect(() => {
        setIsPlaying(false);
        setMicActive(false);
        setLightActive(false);
        setSirenActive(false);
        setStreamLoading(false);
        setProbeData(null);
        setMatterStatus(null);
        setMatterPairing(null);
        setMatterCountdown(0);
    }, [selectedId]);

    // Fetch probe data when entering Info tab
    useEffect(() => {
        if (activeTab === 'info' && selectedId) {
            setProbeLoading(true);
            fetch(`/api/cameras/${selectedId}/probe`)
                .then(res => res.json())
                .then(data => setProbeData(data))
                .catch(err => console.error(err))
                .finally(() => setProbeLoading(false));
        }
    }, [activeTab, selectedId]);

    const handleToggleHEVC = async () => {
        if (!selectedId || !probeData) return;
        const newEnabled = !probeData.hevc_enabled;
        setProbeData({ ...probeData, hevc_enabled: newEnabled });
        await fetch(`/api/cameras/${selectedId}/probe/hevc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newEnabled })
        });
    };

    // Fetch Matter Status and Countdown
    useEffect(() => {
        if (activeTab === 'matter' && selectedId) {
            fetch(`/api/cameras/${selectedId}/matter/status`)
                .then(res => res.json())
                .then(data => setMatterStatus(data));
        }
    }, [activeTab, selectedId]);

    useEffect(() => {
        let timer: any;
        if (matterCountdown > 0) {
            timer = setInterval(() => setMatterCountdown(prev => prev - 1), 1000);
        } else if (matterCountdown === 0 && matterPairing && activeTab === 'matter') {
            // Auto refresh pairing code when it expires
            handleGeneratePairing();
        }
        return () => clearInterval(timer);
    }, [matterCountdown, matterPairing, activeTab]);

    const handleGeneratePairing = async () => {
        if (!selectedId) return;
        const res = await fetch(`/api/cameras/${selectedId}/matter/pairing`);
        const data = await res.json();
        setMatterPairing(data);
        
        // Calculate remaining seconds
        const expiresAt = new Date(data.expiresAt).getTime();
        const now = new Date().getTime();
        setMatterCountdown(Math.floor((expiresAt - now) / 1000));
    };

    const handleUnpair = async () => {
        if (!selectedId) return;
        await fetch(`/api/cameras/${selectedId}/matter/unpair`, { method: 'DELETE' });
        setMatterStatus({ ...matterStatus, isPaired: false, ecosystems: [] });
    };

    const handleCopyLogs = async () => {
        const selectedEvents = events.filter(e => e.camera_id === selectedId);
        const logText = selectedEvents.map(ev => 
            `[${new Date(ev.timestamp).toISOString()}] [${ev.event_type.toUpperCase()}] ${JSON.stringify(ev.metadata)}`
        ).join('\n');
        
        try {
            await navigator.clipboard.writeText(logText);
            alert('Logs copiados al portapapeles');
        } catch (err) {
            console.error('Failed to copy logs', err);
        }
    };

    const handleDownloadLogs = () => {
        const selectedEvents = events.filter(e => e.camera_id === selectedId);
        const logText = selectedEvents.map(ev => 
            `[${new Date(ev.timestamp).toISOString()}] [${ev.event_type.toUpperCase()}] ${JSON.stringify(ev.metadata)}`
        ).join('\n');
        
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `camera-${selectedId}-logs.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleToggleYolo = async () => {
        if (!selectedId) return;
        const currentEnabled = selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true;
        try {
            await fetch(`/api/cameras/${selectedId}/yolo`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !currentEnabled })
            });
            // Let the websocket push the updated camera to refresh UI
        } catch (err) {
            console.error('Failed to toggle YOLO', err);
        }
    };

    const selected = cameras.find(c => c.id === selectedId) ?? null;
    const cameraEvents = events.filter(e => e.camera_id === selectedId);

    const handleDelete = async (id: string) => {
        if (!confirm('¿Eliminar esta cámara y todo su historial? Esta acción no se puede deshacer.')) return;
        setDeletingId(id);
        setDeleteError(null);
        try {
            await onDelete(id);
            if (selectedId === id) setSelectedId(cameras.find(c => c.id !== id)?.id ?? null);
        } catch (err: unknown) {
            setDeleteError(err instanceof Error ? err.message : String(err));
        } finally {
            setDeletingId(null);
        }
    };

    // ── Empty state ────────────────────────────────────────────────────────────
    if (cameras.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center py-20 px-8
                            border border-dashed border-white/10 rounded-2xl">
                <div className="w-16 h-16 mb-4 rounded-full bg-white/5 flex items-center justify-center text-3xl">
                    📷
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">Sin cámaras configuradas</h3>
                <p className="text-sm text-gray-500 max-w-xs">
                    Agrega tu primera cámara usando el botón de arriba. Soportamos RTSP, ONVIF y Google Nest SDM.
                </p>
            </div>
        );
    }

    return (
        <div className="flex gap-4 w-full">
            {/* ── Camera sidebar ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-2 w-52 shrink-0">
                {cameras.map(cam => (
                    <button
                        key={cam.id}
                        onClick={() => { setSelectedId(cam.id); setActiveTab('preview'); }}
                        className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                            selectedId === cam.id
                                ? 'border-blue-500/50 bg-blue-500/10'
                                : 'border-white/5 bg-white/[0.02] hover:bg-white/5'
                        }`}
                    >
                        <div className="flex items-center gap-2 w-full mb-1">
                            {getBrandLogo(cam.name) ? (
                                <img src={getBrandLogo(cam.name)} alt="brand" className="w-5 h-5 object-contain opacity-90" />
                            ) : (
                                <span className="text-sm opacity-50">📷</span>
                            )}
                            <span className="text-sm font-semibold text-white truncate flex-1">{cam.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">{cam.ip}</span>
                        <span className={`mt-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full ${STATUS_COLORS[cam.status]}`}>
                            {STATUS_LABELS[cam.status]}
                        </span>
                    </button>
                ))}
            </div>

            {/* ── Camera detail panel ────────────────────────────────────── */}
            {selected && (
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* Camera header */}
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold flex items-center gap-3">
                                {getBrandLogo(selected.name) ? (
                                    <img src={getBrandLogo(selected.name)} alt="brand" className="w-8 h-8 object-contain drop-shadow-md" />
                                ) : (
                                    <span>📷</span>
                                )}
                                {selected.name}
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${STATUS_COLORS[selected.status]}`}>
                                    {STATUS_LABELS[selected.status]}
                                </span>
                            </h2>
                            <p className="text-xs text-gray-500 font-mono mt-1">
                                {selected.protocol} · {selected.ip}:{selected.port}
                                {selected.codec && ` · ${selected.codec}`}
                            </p>
                        </div>
                        <button
                            onClick={() => handleDelete(selected.id)}
                            disabled={deletingId === selected.id}
                            className="px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                            {deletingId === selected.id ? 'Eliminando…' : '🗑 Eliminar'}
                        </button>
                    </div>

                    {deleteError && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                            {deleteError}
                        </p>
                    )}

                    {/* Tabs */}
                    <div className="flex gap-1 border-b border-white/10">
                        {(['preview', 'logs', 'info', 'matter', 'sensors'] as ActiveTab[]).map(t => (
                            <button
                                key={t}
                                onClick={() => setActiveTab(t)}
                                className={`px-4 py-2 text-sm font-medium border-b-2 capitalize transition-colors ${
                                    activeTab === t
                                        ? 'border-blue-500 text-white'
                                        : 'border-transparent text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {t === 'preview' ? 'Preview' : t === 'logs' ? 'Logs' : t === 'info' ? 'Info' : t === 'matter' ? 'Matter' : 'Sensores'}
                            </button>
                        ))}
                    </div>

                            {/* ── Tabs Content ─────────────────────────────────────────── */}
                            <div className="flex-1 bg-black/20 rounded-b-xl border border-t-0 border-white/10 overflow-hidden relative min-h-[400px]">
                                {activeTab === 'preview' && (
                                    <div className="absolute inset-0 flex flex-col">
                                        {/* Video area */}
                                        <div className="flex-1 relative bg-black flex items-center justify-center">
                                            {isPlaying ? (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    {streamLoading ? (
                                                        <div className="flex flex-col items-center gap-3">
                                                            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                                                            <span className="text-sm text-gray-400 font-mono">Iniciando Stream HLS/MPEG-TS...</span>
                                                        </div>
                                                    ) : (
                                                        <div className="relative w-full h-full bg-slate-900 overflow-hidden flex flex-col items-center justify-center">
                                                            <span className="text-gray-500 font-mono text-sm">[Video Stream En Vivo]</span>
                                                            {/* HUD */}
                                                            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md border border-white/10 rounded px-3 py-1.5 flex flex-col items-end gap-1 text-[10px] font-mono text-white/80">
                                                                <div>CODEC: <span className="text-blue-400 font-bold">{selected.codec || 'H.265'}</span></div>
                                                                <div>RES: <span className="text-emerald-400">1920x1080</span></div>
                                                                <div>FPS: <span className="text-yellow-400">30</span></div>
                                                                <div>BITRATE: <span>2.5 Mbps</span></div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center">
                                                    <div className="w-16 h-16 rounded-full bg-white/5 mx-auto flex items-center justify-center mb-4">
                                                        <span className="text-2xl opacity-50">⏸️</span>
                                                    </div>
                                                    <p className="text-sm text-gray-500">Stream pausado.</p>
                                                    <p className="text-xs text-gray-600 mt-1">Haz clic en Play para iniciar la transmisión.</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Control Bar */}
                                        <div className="h-14 bg-[#0c1015] border-t border-white/10 flex items-center justify-between px-4">
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={async () => {
                                                        if (isPlaying) {
                                                            setIsPlaying(false);
                                                            await fetch(`/api/cameras/${selected.id}/stream/stop`, { method: 'POST' });
                                                        } else {
                                                            setIsPlaying(true);
                                                            setStreamLoading(true);
                                                            await fetch(`/api/cameras/${selected.id}/stream/start`, { method: 'POST' });
                                                            setTimeout(() => setStreamLoading(false), 1500); // Mock loading
                                                        }
                                                    }}
                                                    className={`px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${isPlaying ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-emerald-500 text-white hover:bg-emerald-400'}`}
                                                >
                                                    {isPlaying ? '⏹ Detener' : '▶ Reproducir'}
                                                </button>

                                                <button 
                                                    disabled={!isPlaying}
                                                    onClick={() => setIsMuted(!isMuted)}
                                                    className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${isMuted ? 'bg-white/5 text-gray-400' : 'bg-blue-500/20 text-blue-400'} disabled:opacity-30`}
                                                >
                                                    {isMuted ? '🔇' : '🔊'}
                                                </button>
                                            </div>

                                            <div className="flex gap-2">
                                                <button 
                                                    disabled={!isPlaying}
                                                    onClick={() => setMicActive(!micActive)}
                                                    className={`px-3 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${micActive ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'} disabled:opacity-30`}
                                                >
                                                    🎤 Mic
                                                </button>
                                                <button 
                                                    onClick={() => setLightActive(!lightActive)}
                                                    className={`px-3 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${lightActive ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    💡 Luz
                                                </button>
                                                <button 
                                                    onClick={() => setSirenActive(!sirenActive)}
                                                    className={`px-3 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${sirenActive ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    🚨 Sirena
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                    {/* Logs tab */}
                    {activeTab === 'logs' && (
                        <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-bold text-white">Registro de Fallos y Eventos (Logs)</h3>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={handleCopyLogs}
                                        disabled={cameraEvents.length === 0}
                                        className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs font-semibold text-white transition-colors disabled:opacity-50"
                                    >
                                        Copiar Logs
                                    </button>
                                    <button 
                                        onClick={handleDownloadLogs}
                                        disabled={cameraEvents.length === 0}
                                        className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 border border-blue-500/30 rounded text-xs font-semibold transition-colors disabled:opacity-50"
                                    >
                                        Descargar (.txt)
                                    </button>
                                </div>
                            </div>
                            
                            <div className="bg-black/60 rounded-xl border border-white/5 h-64 p-3 overflow-y-auto font-mono text-xs flex flex-col gap-1">
                                {cameraEvents.length === 0 ? (
                                    <p className="text-gray-600 italic">Sin eventos recientes o fallos para esta cámara.</p>
                                ) : (
                                    cameraEvents.map(ev => (
                                        <div key={ev.id} className="flex gap-2 items-start">
                                            <span className="text-gray-600 shrink-0">
                                                {new Date(ev.timestamp).toLocaleTimeString()}
                                            </span>
                                            <span className={
                                                ev.event_type === 'error' ? 'text-red-400' :
                                                ev.event_type === 'offline' ? 'text-yellow-400' :
                                                ev.event_type === 'person' || ev.event_type === 'motion' ? 'text-emerald-400' :
                                                'text-blue-300'
                                            }>
                                                [{ev.event_type.toUpperCase()}]
                                            </span>
                                            <span className="text-gray-400 break-all">
                                                {JSON.stringify(ev.metadata)}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {/* Info tab */}
                    {activeTab === 'info' && (
                        <div className="flex flex-col gap-4">
                            {probeLoading ? (
                                <div className="flex justify-center items-center h-32">
                                    <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        {[
                                            ['Video Codec', probeData?.video_codec || selected.codec || '—'],
                                            ['Resolución', probeData ? `${probeData.width}×${probeData.height}` : '—'],
                                            ['FPS', probeData ? probeData.r_frame_rate : '—'],
                                            ['Bitrate Video', probeData ? `${(probeData.bit_rate / 1000000).toFixed(1)} Mbps` : '—'],
                                            ['Audio Codec', probeData ? `${probeData.audio_codec} → Opus` : '—'],
                                            ['Audio Sample', probeData ? `${probeData.audio_sample_rate / 1000} kHz` : '—'],
                                        ].map(([k, v]) => (
                                            <div key={k} className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{k}</p>
                                                <p className="text-sm text-white font-mono truncate mt-0.5 font-semibold">{v}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4 mt-2">
                                        <h4 className="text-sm font-bold text-white mb-3">Opciones de Transcodificación HKSV</h4>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-gray-300">Remux H.264 (Sin transcodificar)</p>
                                                    <p className="text-xs text-gray-500">Envía el stream directo si la cámara es H.264</p>
                                                </div>
                                                <div className="text-emerald-400 font-bold text-sm bg-emerald-500/10 px-2 py-1 rounded">✅ Soportado</div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-gray-300">Remux H.265 (Crudo a HomeKit)</p>
                                                    <p className="text-xs text-gray-500">Requiere iOS 17+. Sin latencia de FFmpeg.</p>
                                                </div>
                                                <div className="text-emerald-400 font-bold text-sm bg-emerald-500/10 px-2 py-1 rounded">✅ Soportado</div>
                                            </div>
                                            <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                                <div>
                                                    <p className="text-sm text-gray-300 font-semibold">Forzar HEVC (H.265) a máxima resolución</p>
                                                    <p className="text-xs text-gray-500">Si la cámara lo permite, cambia su perfil a alta calidad H.265.</p>
                                                </div>
                                                <button
                                                    onClick={handleToggleHEVC}
                                                    disabled={!probeData}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${probeData?.hevc_enabled ? 'bg-blue-600' : 'bg-gray-600'}`}
                                                >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${probeData?.hevc_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Matter tab */}
                    {activeTab === 'matter' && (
                        <div className="flex flex-col py-6 px-4 border border-white/5 bg-black/40 rounded-xl">
                            {matterStatus?.isPaired ? (
                                <div className="flex flex-col items-center">
                                    <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4 border border-emerald-500/30">
                                        <span className="text-3xl">✅</span>
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-1">Emparejado con Matter</h3>
                                    <p className="text-sm text-gray-400 mb-6">Esta cámara ya está configurada en los siguientes ecosistemas:</p>
                                    
                                    <div className="flex gap-4 w-full">
                                        {matterStatus.ecosystems.map((eco: any) => (
                                            <div key={eco.id} className="flex-1 bg-white/[0.03] border border-white/5 rounded-lg p-4 flex flex-col items-center text-center">
                                                <span className="text-2xl mb-2">
                                                    {eco.id === 'apple' ? '🍎' : eco.id === 'google' ? '🇬' : eco.id === 'alexa' ? '🇦' : '🏠'}
                                                </span>
                                                <span className="text-sm font-bold text-white">{eco.name}</span>
                                                <span className="text-xs text-gray-500">{eco.homeName}</span>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <button
                                        onClick={handleUnpair}
                                        className="mt-8 px-6 py-2 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-lg text-sm font-bold border border-red-500/30 transition-colors"
                                    >
                                        Desconectar Emparejamiento
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col md:flex-row gap-8">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="p-2 bg-blue-500/20 rounded-lg border border-blue-500/30">
                                                <span className="text-xl">🌐</span>
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-white">Modo Emparejamiento Matter</h3>
                                                <p className="text-xs text-gray-400">Escanea el código QR con Apple Home, Google Home o Alexa.</p>
                                            </div>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-4 mt-6">
                                            <div className="bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Entidades Expuestas</p>
                                                <p className="text-xs font-mono text-blue-400 font-bold">
                                                    {matterStatus?.capabilities?.join(', ') || 'Stream, Mic, Motion'}
                                                </p>
                                            </div>
                                            <div className="bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Codecs</p>
                                                <p className="text-xs font-mono text-emerald-400 font-bold">
                                                    {selected.codec || 'H.265 (Crudo)'}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="mt-6 text-xs text-gray-500 italic">
                                            Nota: Si hay actualizaciones de complementos, el dispositivo se actualizará automáticamente sin necesidad de volver a emparejar.
                                        </p>
                                    </div>
                                    
                                    <div className="w-full md:w-64 bg-white rounded-xl p-4 flex flex-col items-center justify-center">
                                        {matterPairing ? (
                                            <>
                                                <QRCodeSVG value={matterPairing.qrCode} size={200} />
                                                <p className="text-black font-mono font-bold mt-4 tracking-widest text-lg">
                                                    {matterPairing.manualCode}
                                                </p>
                                                <div className="flex items-center gap-2 mt-4 text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
                                                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                                                    Rotando en {Math.floor(matterCountdown / 60)}:{(matterCountdown % 60).toString().padStart(2, '0')}
                                                </div>
                                            </>
                                        ) : (
                                            <button 
                                                onClick={handleGeneratePairing}
                                                className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors"
                                            >
                                                Generar Código
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Sensors tab */}
                    {activeTab === 'sensors' && (
                        <div className="flex flex-col gap-4 p-4 border border-white/5 bg-black/40 rounded-xl mt-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                                    <span className="text-xl">🧠</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Procesamiento IA Local</h3>
                                    <p className="text-xs text-gray-400">
                                        Analiza el stream RTSP de esta cámara localmente utilizando el modelo YOLOv10 (Zero-Latency).
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-xl">
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-sm">Habilitar YOLOv10</h3>
                                    <p className="text-gray-500 text-xs mt-1">
                                        Activa la detección de objetos y personas por fotograma. Esto aumenta el uso de CPU/GPU del servidor.
                                    </p>
                                </div>
                                <button
                                    onClick={handleToggleYolo}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${(selected.config?.yolo_enabled === 'true' || selected.config?.yolo_enabled === true) ? 'bg-purple-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(selected.config?.yolo_enabled === 'true' || selected.config?.yolo_enabled === true) ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            
                            <div className="mt-4">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Sensores Expuestos (Vía Matterbridge)</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center">
                                        <span className="text-2xl mb-1">🏃‍♂️</span>
                                        <span className="text-xs font-bold text-emerald-400">Persona</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Activado por YOLO o Cámara</span>
                                    </div>
                                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center">
                                        <span className="text-2xl mb-1">🚗</span>
                                        <span className="text-xs font-bold text-emerald-400">Vehículo</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Requiere YOLOv10</span>
                                    </div>
                                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center">
                                        <span className="text-2xl mb-1">🐶</span>
                                        <span className="text-xs font-bold text-emerald-400">Mascota</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Requiere YOLOv10</span>
                                    </div>
                                    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center">
                                        <span className="text-2xl mb-1">📦</span>
                                        <span className="text-xs font-bold text-emerald-400">Paquete</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Soporte HKSV Exclusivo</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            )}
        </div>
    );
}
