import { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { Camera } from '../types/camera';
import type { MediaCapabilities } from '../hooks/useMediaCapabilities';
import { apiUrl, publicAssetUrl } from '../lib/ingress-url';
import { HlsPlayer } from './HlsPlayer';

interface Props {
    cameras: Camera[];
    capabilities?: MediaCapabilities | null;
    onDelete: (id: string) => Promise<void>;
    onRefresh: () => Promise<void>;
}
type ActiveTab = 'preview' | 'logs' | 'info' | 'matter' | 'sensors';
type PersistentCameraLog = { id: string; event: string; metadata: Record<string, unknown>; created_at: string };

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

const BRAND_LOGOS: Record<string, string> = {
    ring: publicAssetUrl('logos/ring.png'),
    wyze: publicAssetUrl('logos/wyze.png'),
    tapo: publicAssetUrl('logos/tapo.jpg'),
    'tp-link': publicAssetUrl('logos/tapo.jpg'),
    tuya: publicAssetUrl('logos/tuya.png'),
    ezviz: publicAssetUrl('logos/ezviz.png'),
    hikvision: publicAssetUrl('logos/hikvision.png'),
    reolink: publicAssetUrl('logos/reolink.png'),
    dahua: publicAssetUrl('logos/dahua.png'),
    google: publicAssetUrl('logos/google-nest.png'),
    nest: publicAssetUrl('logos/google-nest.png'),
    arlo: publicAssetUrl('logos/arlo.png'),
    vimtag: publicAssetUrl('logos/vimtag.png'),
    rtsp: publicAssetUrl('logos/rtsp.png'),
    onvif: publicAssetUrl('logos/onvif.png'),
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

export function LegacyCameraPanel({ cameras, capabilities: sysCaps, onDelete, onRefresh }: Props) {
    const [selectedId, setSelectedId]     = useState<string | null>(cameras[0]?.id ?? null);
    const [activeTab, setActiveTab]       = useState<ActiveTab>('preview');
    const [deletingId, setDeletingId]     = useState<string | null>(null);
    const [deleteError, setDeleteError]   = useState<string | null>(null);

    // Snapshot polling state
    const [isPlaying, setIsPlaying]           = useState(false);
    const [streamLoading, setStreamLoading]   = useState(false);
    const [snapshotObjectUrl, setSnapshotObjectUrl] = useState<string | null>(null);
    const [previewError, setPreviewError]     = useState<string | null>(null);
    const [previewCodec, setPreviewCodec]     = useState<string>('');
    const [_previewProfile, setPreviewProfile] = useState<string>('');
    const [frameCount, setFrameCount]         = useState(0);
    const [previewMode, setPreviewMode]       = useState<'hls' | 'snapshot'>('hls');
    const [fallbackReason, setFallbackReason] = useState<string | null>(null);

    // Refs — not state, so they don't trigger re-renders
    const pollingActive   = useRef(false);
    const currentAC       = useRef<AbortController | null>(null);
    const pollTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prevObjectUrl   = useRef<string | null>(null);
    const firstFrameLogged = useRef(false);
    const selectedIdRef   = useRef<string | null>(null);

    // Matter Pairing State
    const [matterStatus, setMatterStatus] = useState<any>(null);
    const [matterPairing, setMatterPairing] = useState<any>(null);
    const [matterCountdown, setMatterCountdown] = useState<number>(0);
    const [persistentLogs, setPersistentLogs] = useState<PersistentCameraLog[]>([]);
    const [discoveryError, setDiscoveryError] = useState<string | null>(null);
    const [_snapshotError, setSnapshotError] = useState<string | null>(null);
    const [_snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

    // Controls (light/siren still functional; audio removed)
    const [lightActive, setLightActive] = useState(false);
    const [sirenActive, setSirenActive] = useState(false);

    // Probe data (info tab)
    const [probeData, setProbeData] = useState<any>(null);
    const [probeLoading, setProbeLoading] = useState(false);

    // Reset stream state when camera changes
    useEffect(() => {
        setIsPlaying(false);
        setStreamLoading(false);
        setSnapshotObjectUrl(null);
        setPreviewError(null);
        setPreviewCodec('');
        setPreviewProfile('');
        setFrameCount(0);
        setPreviewMode('hls');
        setFallbackReason(null);
        pollingActive.current = false;
        currentAC.current?.abort();
        currentAC.current = null;
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
        firstFrameLogged.current = false;
        selectedIdRef.current = selectedId;
        if (prevObjectUrl.current) { URL.revokeObjectURL(prevObjectUrl.current); prevObjectUrl.current = null; }

        setProbeData(null);
        setMatterStatus(null);
        setMatterPairing(null);
        setMatterCountdown(0);
        setPersistentLogs([]);
        setDiscoveryError(null);
        setSnapshotError(null);
        setSnapshotUrl(null);
        setLightActive(false);
        setSirenActive(false);
    }, [selectedId]);

    // ── Recursive snapshot polling ──────────────────────────────────────────────
    const schedulePoll = useCallback((camId: string, delayMs: number) => {
        if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = setTimeout(async () => {
            if (!pollingActive.current || selectedIdRef.current !== camId) return;

            const ac = new AbortController();
            currentAC.current = ac;

            try {
                const res = await fetch(apiUrl(`api/cameras/${camId}/preview/frame.jpg`), {
                    signal: ac.signal,
                    cache: 'no-store',
                });

                if (!pollingActive.current || selectedIdRef.current !== camId) return;

                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }

                const blob = await res.blob();
                const newUrl = URL.createObjectURL(blob);

                // Read adaptive TTL from server header
                const ttlMs = parseInt(res.headers.get('X-Frame-TTL') || '1000', 10) || 1000;
                const codec = res.headers.get('X-Frame-Codec') || '';
                const profileId = res.headers.get('X-Frame-Profile') || '';

                // Revoke previous blob URL
                if (prevObjectUrl.current) URL.revokeObjectURL(prevObjectUrl.current);
                prevObjectUrl.current = newUrl;

                setSnapshotObjectUrl(newUrl);
                setStreamLoading(false);
                setPreviewError(null);
                setPreviewCodec(codec);
                setPreviewProfile(profileId);
                setFrameCount(c => c + 1);

                // Schedule next poll only after this one completes
                if (pollingActive.current && selectedIdRef.current === camId) {
                    schedulePoll(camId, ttlMs);
                }
            } catch (err: any) {
                if (err?.name === 'AbortError') return;
                if (!pollingActive.current || selectedIdRef.current !== camId) return;
                setStreamLoading(false);
                setPreviewError(err instanceof Error ? err.message : String(err));
                pollingActive.current = false;
                setIsPlaying(false);
            }
        }, delayMs);
    }, []);

    // Existing cameras created before discovery are retried once when selected.
    useEffect(() => {
        if (!selectedId) return;
        fetch(apiUrl(`api/cameras/${selectedId}/capabilities`))
            .then(response => response.json())
            .then(data => {
                if (data.discovery_status === 'pending') return fetch(apiUrl(`api/cameras/${selectedId}/discover`), { method: 'POST' });
                return undefined;
            })
            .catch(() => undefined);
    }, [selectedId]);

    // Fetch probe data when entering Info tab
    useEffect(() => {
        if (activeTab === 'info' && selectedId) {
            setProbeLoading(true);
            fetch(apiUrl(`api/cameras/${selectedId}/probe`))
                .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'No se pudo descubrir la cámara'); return data; })
                .then(data => setProbeData(data))
                .catch(err => console.error(err))
                .finally(() => setProbeLoading(false));
        }
    }, [activeTab, selectedId]);

    const handleToggleHEVC = async () => {
        if (!selectedId || !probeData) return;
        if (!capabilities?.video.supportsH265) {
            alert('Para activar Remuxing HEVC puro, cambia el formato de video a H.265 en la aplicación oficial de tu cámara y luego presiona "Descubrir" aquí de nuevo para que Scryvex lo detecte.');
            return;
        }
        const newEnabled = !probeData.hevc_enabled;
        setProbeData({ ...probeData, hevc_enabled: newEnabled });
        await fetch(apiUrl(`api/cameras/${selectedId}/probe/hevc`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newEnabled })
        });
    };

    // Fetch Matter Status and Countdown
    useEffect(() => {
        if (activeTab === 'matter' && selectedId) {
            fetch(apiUrl(`api/cameras/${selectedId}/matter/status`))
                .then(res => res.json())
                .then(data => setMatterStatus(data));
        }
    }, [activeTab, selectedId]);

    useEffect(() => {
        if (activeTab !== 'logs' || !selectedId) return;
        fetch(apiUrl(`api/cameras/${selectedId}/logs`))
            .then(res => res.json())
            .then(data => setPersistentLogs(Array.isArray(data.logs) ? data.logs : []))
            .catch(err => console.error('Failed to load camera logs', err));
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
    }, [matterCountdown, matterPairing, activeTab, handleGeneratePairing]);

    const handleGeneratePairing = async () => {
        if (!selectedId) return;
        const res = await fetch(apiUrl(`api/cameras/${selectedId}/matter/pairing`));
        const data = await res.json();
        setMatterPairing(data);
        
        // Calculate remaining seconds
        const expiresAt = new Date(data.expiresAt).getTime();
        const now = new Date().getTime();
        setMatterCountdown(Math.floor((expiresAt - now) / 1000));
    };

    const handleUnpair = async () => {
        if (!selectedId) return;
        await fetch(apiUrl(`api/cameras/${selectedId}/matter/unpair`), { method: 'DELETE' });
        setMatterStatus({ ...matterStatus, isPaired: false, ecosystems: [] });
    };

    const handleCopyLogs = async () => {
        const logText = persistentLogs.map(log =>
            `[${new Date(log.created_at).toISOString()}] [${log.event}] ${JSON.stringify(log.metadata)}`
        ).join('\n');
        
        try {
            await navigator.clipboard.writeText(logText);
            alert('Logs copiados al portapapeles');
        } catch (err) {
            console.error('Failed to copy logs', err);
        }
    };

    const handleDownloadLogs = () => {
        const logText = persistentLogs.map(log =>
            `[${new Date(log.created_at).toISOString()}] [${log.event}] ${JSON.stringify(log.metadata)}`
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

    const handleExecuteAction = async (action: 'light' | 'siren', currentState: boolean) => {
        if (!selectedId) return;
        const newState = !currentState;
        
        if (action === 'light') setLightActive(newState);
        if (action === 'siren') setSirenActive(newState);

        try {
            const response = await fetch(apiUrl(`api/cameras/${selectedId}/actions/${action}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: newState })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'Error ejecutando acción');
        } catch (error) {
            alert(`Error al enviar el comando a la cámara: ${error instanceof Error ? error.message : String(error)}`);
            if (action === 'light') setLightActive(currentState);
            if (action === 'siren') setSirenActive(currentState);
        }
    };

    const selected = cameras.find(c => c.id === selectedId) ?? null;
    const capabilities = selected?.capabilities;

    const handleDiscover = async () => {
        if (!selectedId) return;
        setStreamLoading(true);
        setDiscoveryError(null);
        try {
            const response = await fetch(apiUrl(`api/cameras/${selectedId}/discover`), { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'No se pudo descubrir la cámara');
            await onRefresh();
        } catch (error) {
            setDiscoveryError(error instanceof Error ? error.message : String(error));
        } finally {
            setStreamLoading(false);
        }
    };

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
                        <span className={`mt-1.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full ${STATUS_COLORS[cam.diagnostics?.status as any] || STATUS_COLORS.unknown}`}>
                            {STATUS_LABELS[cam.diagnostics?.status as any] || 'ONLINE'}
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
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${STATUS_COLORS[selected.diagnostics?.status as any] || STATUS_COLORS.unknown}`}>
                                    {STATUS_LABELS[selected.diagnostics?.status as any] || 'ONLINE'}
                                </span>
                            </h2>
                            <p className="text-xs text-gray-500 font-mono mt-1">
                                {selected.plugin} {selected.ip ? `· ${selected.ip}:${selected.port}` : ''}
                                {selected.codec && ` · ${selected.codec}`}
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleDiscover} disabled={streamLoading} className="px-3 py-1.5 text-xs font-bold text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 transition-colors disabled:opacity-50">{streamLoading ? 'Detectando…' : '⌕ Detectar'}</button>
                            <button onClick={() => handleDelete(selected.id)} disabled={deletingId === selected.id} className="px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50">{deletingId === selected.id ? 'Eliminando…' : '🗑 Eliminar'}</button>
                        </div>
                    </div>

                    {deleteError && (
                        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                            {deleteError}
                        </p>
                    )}
                    {discoveryError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">Descubrimiento fallido: {discoveryError}. {selected.protocol === 'ONVIF' ? 'Confirma el puerto ONVIF y las credenciales.' : 'Confirma la URL RTSP y sus credenciales.'}</p>}

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
                                        {sysCaps && (!sysCaps.ffmpeg?.usable) && (
                                            <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-center text-xs text-red-400 font-bold z-10">
                                                FFmpeg no está disponible. El servidor no puede generar snapshots.
                                            </div>
                                        )}

                                        {/* Video area */}
                                        <div className="flex-1 relative bg-black flex items-center justify-center">
                                            {isPlaying ? (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    {streamLoading ? (
                                                        <div className="flex flex-col items-center gap-3">
                                                            <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                                                            <span className="text-sm text-gray-400 font-mono">Obteniendo primer frame…</span>
                                                        </div>
                                                    ) : (
                                                        <div className="relative w-full h-full bg-slate-900 overflow-hidden flex flex-col items-center justify-center">
                                                            {previewError ? (
                                                                <div className="flex flex-col items-center justify-center p-6 bg-red-900/20 border border-red-500/30 rounded-xl max-w-lg text-center">
                                                                    <div className="text-red-500 text-3xl mb-3">⚠️</div>
                                                                    <div className="text-sm font-bold text-white mb-2">Error de Preview</div>
                                                                    <div className="text-sm font-mono text-gray-300 w-full text-left bg-black/50 p-4 rounded mt-2">
                                                                        <div className="text-emerald-400">Discovery: correcto</div>
                                                                        <div className="text-emerald-400">RTSP detectado: correcto</div>
                                                                        <div className="text-red-400">Snapshot: fallido</div>
                                                                        <div className="mt-2 text-gray-400 text-xs">Error:</div>
                                                                        <div className="text-red-300 text-xs whitespace-pre-wrap">{previewError}</div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => { setPreviewError(null); pollingActive.current = true; schedulePoll(selected.id, 0); }}
                                                                        className="mt-4 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg"
                                                                    >Reintentar</button>
                                                                </div>
                                                            ) : previewMode === 'hls' ? (
                                                                <HlsPlayer 
                                                                    cameraId={selected.id}
                                                                    hasAudio={capabilities?.audio.available ?? false}
                                                                    onSnapshotFallback={(reason) => {
                                                                        setFallbackReason(reason);
                                                                        setPreviewMode('snapshot');
                                                                        pollingActive.current = true;
                                                                        schedulePoll(selected.id, 0);
                                                                    }}
                                                                />
                                                            ) : snapshotObjectUrl ? (
                                                                <img
                                                                    key={snapshotObjectUrl}
                                                                    src={snapshotObjectUrl}
                                                                    alt={`Preview de ${selected.name}`}
                                                                    className="w-full h-full object-contain"
                                                                />
                                                            ) : (
                                                                <span className="text-gray-500 font-mono text-sm">Conectando Snapshot…</span>
                                                            )}
                                                            {/* HUD */}
                                                            {((snapshotObjectUrl && previewMode === 'snapshot') || previewMode === 'hls') && !previewError && (
                                                                <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md border border-white/10 rounded px-3 py-1.5 flex flex-col items-end gap-1 text-[10px] font-mono text-white/80 z-20">
                                                                    <div className="bg-white/10 px-1.5 rounded font-bold mb-1">{previewMode === 'hls' ? 'HLS LIVE' : 'SNAPSHOT'}</div>
                                                                    {previewMode === 'hls' ? (
                                                                        <>
                                                                            <div>VIDEO: <span className="text-blue-400 font-bold">H.264 720p</span></div>
                                                                            <div>AUDIO: <span className="text-emerald-400">{capabilities?.audio.available ? 'AAC-LC 48kHz' : 'No'}</span></div>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <div>CODEC: <span className="text-blue-400 font-bold">{previewCodec || 'Detectando…'}</span></div>
                                                                            <div>FRAMES: <span className="text-yellow-400">{frameCount}</span></div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {fallbackReason && previewMode === 'snapshot' && !previewError && (
                                                                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[10px] px-3 py-1 rounded-full backdrop-blur-md whitespace-nowrap z-20">
                                                                    Fallback: {fallbackReason}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-center">
                                                    <div className="w-16 h-16 rounded-full bg-white/5 mx-auto flex items-center justify-center mb-4">
                                                        <span className="text-2xl opacity-50">📷</span>
                                                    </div>
                                                    <p className="text-sm text-gray-500">Preview pausado.</p>
                                                    <p className="text-xs text-gray-600 mt-1">Haz clic en Play para iniciar el snapshot polling.</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Control Bar */}
                                        <div className="h-14 bg-[#0c1015] border-t border-white/10 flex items-center justify-between px-4">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => {
                                                        if (isPlaying) {
                                                            // Stop
                                                            pollingActive.current = false;
                                                            currentAC.current?.abort();
                                                            currentAC.current = null;
                                                            if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
                                                            if (prevObjectUrl.current) { URL.revokeObjectURL(prevObjectUrl.current); prevObjectUrl.current = null; }
                                                            setSnapshotObjectUrl(null);
                                                            setIsPlaying(false);
                                                            setPreviewError(null);
                                                            setFrameCount(0);
                                                            firstFrameLogged.current = false;
                                                        } else {
                                                            // Start
                                                            setIsPlaying(true);
                                                            setStreamLoading(false); // HLS Player handles its own loading state
                                                            setPreviewError(null);
                                                            setFrameCount(0);
                                                            setPreviewMode('hls');
                                                            setFallbackReason(null);
                                                            firstFrameLogged.current = false;
                                                            // We don't call schedulePoll here unless fallback happens
                                                        }
                                                    }}
                                                    className={`px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${!sysCaps || sysCaps.ffmpeg?.usable ? (isPlaying ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-emerald-500 text-white hover:bg-emerald-400') : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                                                    disabled={sysCaps && (!sysCaps.ffmpeg?.usable)}
                                                >
                                                    {isPlaying ? '⏹ Detener' : '▶ Reproducir'}
                                                </button>
                                            </div>

                                            <div className="flex gap-2">
                                                {capabilities?.controls.lightControl && <button
                                                    onClick={() => handleExecuteAction('light', lightActive)}
                                                    className={`px-3 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${lightActive ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    💡 Luz
                                                </button>}
                                                {capabilities?.controls.sirenControl && <button
                                                    onClick={() => handleExecuteAction('siren', sirenActive)}
                                                    className={`px-3 h-10 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors ${sirenActive ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    🚨 Sirena
                                                </button>}
                                                <span className="text-[9px] text-gray-600 font-mono self-center">{previewMode === 'hls' ? 'Live HLS · Fase 1 (RC1)' : 'Snapshot Polling · Fase A'}</span>
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
                                        disabled={persistentLogs.length === 0}
                                        className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs font-semibold text-white transition-colors disabled:opacity-50"
                                    >
                                        Copiar Logs
                                    </button>
                                    <button 
                                        onClick={handleDownloadLogs}
                                        disabled={persistentLogs.length === 0}
                                        className="px-3 py-1 bg-blue-500/20 hover:bg-blue-500/40 text-blue-400 border border-blue-500/30 rounded text-xs font-semibold transition-colors disabled:opacity-50"
                                    >
                                        Descargar (.txt)
                                    </button>
                                </div>
                            </div>
                            
                            <div className="bg-black/60 rounded-xl border border-white/5 h-64 p-3 overflow-y-auto font-mono text-xs flex flex-col gap-1">
                                {persistentLogs.length === 0 ? (
                                    <p className="text-gray-600 italic">Sin logs persistentes para esta cámara.</p>
                                ) : (
                                    persistentLogs.map(log => (
                                        <div key={log.id} className="flex gap-2 items-start">
                                            <span className="text-gray-600 shrink-0">
                                                {new Date(log.created_at).toLocaleTimeString()}
                                            </span>
                                            <span className={log.event.includes('failed') ? 'text-red-400' : 'text-blue-300'}>
                                                [{log.event.toUpperCase()}]
                                            </span>
                                            <span className="text-gray-400 break-all">
                                                {JSON.stringify(log.metadata)}
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
                                            ['Video Codec', capabilities?.video.profiles[0]?.codec || 'No detectado'],
                                            ['Resolución', capabilities?.video.profiles[0]?.width && capabilities.video.profiles[0]?.height ? `${capabilities.video.profiles[0].width}×${capabilities.video.profiles[0].height}` : 'No detectada'],
                                            ['FPS', capabilities?.video.profiles[0]?.fps ?? 'No detectados'],
                                            ['Bitrate Video', capabilities?.video.profiles[0]?.bitrate ? `${(capabilities.video.profiles[0].bitrate / 1000000).toFixed(1)} Mbps` : 'No detectado'],
                                            ['Audio Codec', capabilities?.audio.codecs.join(', ') || 'No detectado'],
                                            ['Audio Sample', capabilities?.audio.sampleRates.map(rate => `${rate / 1000} kHz`).join(', ') || 'No detectado'],
                                            ['Entidades ONVIF', capabilities?.detectedEntities?.join(', ') || 'Ninguna anunciada'],
                                        ].map(([k, v]) => (
                                            <div key={k} className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{k}</p>
                                                <p className="text-sm text-white font-mono truncate mt-0.5 font-semibold">{v}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4 mt-2">
                                        <h4 className="text-sm font-bold text-white mb-3">Capacidades detectadas</h4>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                <p className="text-sm text-gray-300">H.264</p>
                                                <p className="text-xs text-gray-500">{capabilities?.video.supportsH264 ? 'Detectado' : 'No detectado'}</p>
                                                </div>
                                                <div className="text-gray-400 font-bold text-sm bg-white/5 px-2 py-1 rounded">{capabilities?.video.supportsH264 ? '✅ Detectado' : '—'}</div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div>
                                                <p className="text-sm text-gray-300">H.265</p>
                                                <p className="text-xs text-gray-500">{capabilities?.video.supportsH265 ? 'Detectado' : 'No detectado'}</p>
                                                </div>
                                                <div className="text-gray-400 font-bold text-sm bg-white/5 px-2 py-1 rounded">{capabilities?.video.supportsH265 ? '✅ Detectado' : '—'}</div>
                                            </div>
                                            <div className="flex items-center justify-between pt-2 border-t border-white/5">
                                                <div>
                                                <p className="text-sm text-gray-300 font-semibold">Remuxing H.265 (Apple tvOS 27)</p>
                                                <p className="text-xs text-gray-500">Requiere que la cámara esté enviando H.265 puro.</p>
                                                </div>
                                                <button
                                                    onClick={handleToggleHEVC}
                                                    className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors bg-gray-600 hover:bg-gray-500"
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
                                    
                                    <div className="flex gap-4 w-full flex-wrap justify-center">
                                        {matterStatus.ecosystems.map((eco: any) => (
                                            <div key={eco.fabricIndex} className="w-64 bg-white/[0.03] border border-white/5 rounded-lg p-4 flex flex-col items-center text-center">
                                                <span className="text-2xl mb-2">
                                                    {eco.appleFabricPresent || eco.vendorId === 0x1349 ? '🍎' : eco.vendorId === 0x1343 ? '🇬' : eco.vendorId === 0x118D ? '🇦' : '🏠'}
                                                </span>
                                                <span className="text-sm font-bold text-white">
                                                    {eco.appleFabricPresent || eco.vendorId === 0x1349 ? 'Apple Home' : `Vendor 0x${eco.vendorId.toString(16).toUpperCase()}`}
                                                </span>
                                                <span className="text-xs text-gray-400 mt-1">
                                                    {eco.fabricLabel || 'Nombre no informado por Apple'}
                                                </span>
                                                <span className="text-[10px] text-gray-500 font-mono mt-2">
                                                    Node ID: {eco.nodeId}
                                                </span>
                                                <span className="text-[10px] text-gray-500 font-mono">
                                                    Fabric Index: {eco.fabricIndex}
                                                </span>
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
                                                    {matterStatus?.capabilities?.join(', ') || 'No detectadas'}
                                                </p>
                                            </div>
                                            <div className="bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
                                                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Codecs</p>
                                                <p className="text-xs font-mono text-emerald-400 font-bold">
                                                    {capabilities?.video.profiles.map(profile => profile.codec).filter(Boolean).join(', ') || 'No detectados'}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="mt-6 text-xs text-gray-500 italic">
                                            Nota: Si hay actualizaciones de complementos, el dispositivo se actualizará automáticamente sin necesidad de volver a emparejar.
                                        </p>
                                    </div>
                                    
                                    <div className="w-full md:w-64 bg-white rounded-xl p-4 flex flex-col items-center justify-center">
                                        {matterStatus?.status === 'unavailable' ? (
                                            <p className="text-sm text-gray-500 text-center">Matter no disponible: {matterStatus.reason}</p>
                                        ) : matterPairing ? (
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
                                                disabled={matterStatus?.status !== 'available'}
                                                className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
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
                            
                            {/* NATIVE SENSORS */}
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-blue-500/20 rounded-lg border border-blue-500/30">
                                    <span className="text-xl">📡</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Sensores Nativos de la Cámara</h3>
                                    <p className="text-xs text-gray-400">
                                        Detectados vía ONVIF. Si estos sensores se iluminan, significa que están enviando datos en tiempo real.
                                    </p>
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                                <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center transition-colors ${capabilities?.controls.motionEvents ? 'hover:bg-blue-500/10 hover:border-blue-500/30' : 'opacity-50 grayscale'}`}>
                                    <span className="text-2xl mb-1">🏃‍♂️</span>
                                    <span className="text-xs font-bold text-white">Movimiento</span>
                                    <span className="text-[9px] text-gray-500 text-center mt-1">{capabilities?.controls.motionEvents ? 'Sensor Activo' : 'No soportado'}</span>
                                </div>
                                <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center transition-colors ${capabilities?.audio.input ? 'hover:bg-emerald-500/10 hover:border-emerald-500/30' : 'opacity-50 grayscale'}`}>
                                    <span className="text-2xl mb-1">🎤</span>
                                    <span className="text-xs font-bold text-white">Audio/Ruido</span>
                                    <span className="text-[9px] text-gray-500 text-center mt-1">{capabilities?.audio.input ? 'Micrófono Activo' : 'No soportado'}</span>
                                </div>
                                <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center transition-colors ${capabilities?.controls.siren ? 'hover:bg-red-500/10 hover:border-red-500/30' : 'opacity-50 grayscale'}`}>
                                    <span className="text-2xl mb-1">🚨</span>
                                    <span className="text-xs font-bold text-white">Sirena</span>
                                    <span className="text-[9px] text-gray-500 text-center mt-1">{capabilities?.controls.siren ? 'Alarma Detectada' : 'No soportada'}</span>
                                </div>
                                <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center transition-colors ${capabilities?.controls.light ? 'hover:bg-yellow-500/10 hover:border-yellow-500/30' : 'opacity-50 grayscale'}`}>
                                    <span className="text-2xl mb-1">💡</span>
                                    <span className="text-xs font-bold text-white">Luz</span>
                                    <span className="text-[9px] text-gray-500 text-center mt-1">{capabilities?.controls.light ? 'Iluminador Activo' : 'No soportada'}</span>
                                </div>
                            </div>

                            {/* YOLO AI */}
                            <div className="flex items-center gap-3 mb-2 border-t border-white/5 pt-6">
                                <div className="p-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                                    <span className="text-xl">🧠</span>
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Procesamiento IA Local (YOLOv10)</h3>
                                    <p className="text-xs text-gray-400">
                                        Úsalo solo si tu cámara no tiene sensores nativos inteligentes. Aceleración por hardware incluida.
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-xl">
                                <div className="flex-1">
                                    <h3 className="text-white font-bold text-sm">Habilitar Detección YOLOv10</h3>
                                    <p className="text-gray-500 text-xs mt-1">
                                        {capabilities?.yolo.available ? 'El modelo ONNX está listo para procesar este stream.' : (capabilities?.yolo.reason ?? 'Cámara sin preview RTSP.')}
                                    </p>
                                </div>
                                <button
                                    onClick={handleToggleYolo}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${!capabilities?.yolo.available ? 'bg-gray-700/50' : 'bg-gray-600 hover:bg-gray-500'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true) ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            
                            <div className="mt-4">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Capacidades de IA Generadas</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center ${(selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true) ? '' : 'opacity-50 grayscale'}`}>
                                        <span className="text-2xl mb-1">🏃‍♂️</span>
                                        <span className="text-xs font-bold text-emerald-400">Persona</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Generado por YOLO</span>
                                    </div>
                                    <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center ${(selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true) ? '' : 'opacity-50 grayscale'}`}>
                                        <span className="text-2xl mb-1">🚗</span>
                                        <span className="text-xs font-bold text-emerald-400">Vehículo</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Generado por YOLO</span>
                                    </div>
                                    <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center ${(selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true) ? '' : 'opacity-50 grayscale'}`}>
                                        <span className="text-2xl mb-1">🐶</span>
                                        <span className="text-xs font-bold text-emerald-400">Mascota</span>
                                        <span className="text-[9px] text-gray-500 text-center mt-1">Generado por YOLO</span>
                                    </div>
                                    <div className={`bg-white/[0.03] border border-white/5 rounded-lg p-3 flex flex-col items-center ${(selected?.config?.yolo_enabled === 'true' || selected?.config?.yolo_enabled === true) ? '' : 'opacity-50 grayscale'}`}>
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
