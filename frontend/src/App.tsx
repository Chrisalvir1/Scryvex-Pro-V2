import { useState } from 'react';
import { useScryptedCameras } from './hooks/useScryptedCameras';
import { useUniversalDevices } from './hooks/useUniversalDevices';
import { LegacyCameraPanel } from './components/LegacyCameraPanel';
import { UniversalDeviceList } from './components/universal/UniversalDeviceList';
import { AddCameraModal } from './components/AddCameraModal';
import { useMediaCapabilities } from './hooks/useMediaCapabilities';
import type { CreateCameraInput } from './types/camera';

// ── Connection state indicator ────────────────────────────────────────────────
const CONNECTION_BADGE: Record<string, { label: string; className: string }> = {
    connected:    { label: 'En Vivo', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    connecting:   { label: 'Conectando…', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    reconnecting: { label: 'Reconectando…', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    error:        { label: 'Solo REST ✓', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

export default function App() {
    const {
        cameras,
        loading,
        connectionState,
        error,
        addCamera,
        deleteCamera,
        refetch,
    } = useScryptedCameras();

    const { response: sysResponse, capabilities, refreshCapabilities } = useMediaCapabilities();

    const [showAddModal, setShowAddModal] = useState(false);
    const [currentView, setCurrentView] = useState<'cameras' | 'plugins'>('cameras');
    const [uiMode, setUiMode] = useState<'universal' | 'legacy' | 'loading'>('loading');

    useEffect(() => {
        fetch(apiUrl('/api/system/ui-config'))
            .then(res => res.json())
            .then(data => setUiMode(data.cameraUi || 'universal'))
            .catch(() => setUiMode('universal')); // Default to universal on error
    }, []);

    const universal = useUniversalDevices();

    const handleAddCamera = async (input: CreateCameraInput) => {
        await addCamera(input);
    };

    const badge = CONNECTION_BADGE[connectionState] ?? CONNECTION_BADGE.error;

    return (
        <div className="min-h-screen bg-[#080c10] text-white">

            {/* ── Diagnostics Banner ────────────────────────────────── */}
            {sysResponse?.status === 'checking' && (
                <div className="bg-yellow-500/20 text-yellow-400 px-6 py-2 text-sm font-medium flex items-center justify-center gap-2 border-b border-yellow-500/20">
                    <span className="w-4 h-4 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin"></span>
                    Diagnosticando capacidades multimedia (FFmpeg/FFprobe)...
                </div>
            )}
            
            {(sysResponse?.status === 'degraded' || sysResponse?.status === 'failed') && (
                <div className="bg-red-500/20 text-red-400 border-b border-red-500/30 px-6 py-3 text-sm flex items-start sm:items-center justify-center gap-3">
                    <svg className="w-5 h-5 flex-shrink-0 mt-0.5 sm:mt-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                        <span>
                            <strong>Modo {sysResponse?.status === 'failed' ? 'Crítico' : 'Degradado'}:</strong> Las herramientas de procesamiento de video ({[
                                !capabilities?.ffmpeg?.usable ? 'FFmpeg' : null,
                                !capabilities?.ffprobe?.usable ? 'FFprobe' : null
                            ].filter(Boolean).join(' y ')}) no están disponibles o fallaron. Funciones como Preview, Remux y Transcodificación podrían estar deshabilitadas.
                        </span>
                        <button onClick={refreshCapabilities} className="px-3 py-1 bg-red-500/20 hover:bg-red-500/40 rounded transition-colors text-xs font-bold uppercase tracking-wider">Reintentar</button>
                    </div>
                </div>
            )}

            {/* ── Header ─────────────────────────────────────────────────── */}
            <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#080c10]/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-sm font-black">
                            S
                        </div>
                        <h1 className="text-xl font-bold tracking-tight">
                            Scryvex <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">Pro</span>
                        </h1>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Real-time connection badge */}
                        <span className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-full border ${badge.className}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`} />
                            {badge.label}
                        </span>

                        <span className="text-xs text-gray-600 font-mono">
                            {uiMode === 'legacy' ? cameras.length : universal.devices.length} dispositivo{ (uiMode === 'legacy' ? cameras.length : universal.devices.length) !== 1 ? 's' : ''}
                        </span>

                        <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 mx-4">
                            <button
                                onClick={() => setCurrentView('cameras')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-2 ${currentView === 'cameras' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                Dispositivos {uiMode === 'legacy' && <span className="bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded text-[8px]">LEGACY</span>}
                            </button>
                            <button
                                onClick={() => setCurrentView('plugins')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-2 ${currentView === 'plugins' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                Plugins <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-[9px]">NUEVO</span>
                            </button>
                        </div>

                        <button
                            onClick={() => setShowAddModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                        >
                            <span>+</span>
                            <span>Agregar Cámara</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Main content ───────────────────────────────────────────── */}
            <main className="max-w-7xl mx-auto px-6 py-8">

                {/* Loading state */}
                {(loading || universal.loading || uiMode === 'loading') && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-500">Iniciando Scryvex Pro...</p>
                    </div>
                )}

                {/* Error state — server unreachable, but only block UI if we already have cameras to show, otherwise fallback to empty state */}
                {!(loading || universal.loading || uiMode === 'loading') && (error || universal.error) && (cameras.length > 0 || universal.devices.length > 0) && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <span className="text-4xl">⚠️</span>
                        <div>
                            <h2 className="text-lg font-semibold text-red-400 mb-1">Error de conexión con el servidor</h2>
                            <p className="text-sm text-gray-500 max-w-sm">{error || universal.error}</p>
                        </div>
                        <p className="text-xs text-gray-700">
                            El servidor Scryvex Pro puede estar iniciando. La interfaz se reconectará automáticamente.
                        </p>
                    </div>
                )}

                {/* Normal state — camera list or empty state */}
                {!(loading || universal.loading || uiMode === 'loading') && currentView === 'cameras' && uiMode === 'legacy' && (
                    <LegacyCameraPanel
                        cameras={cameras}
                        capabilities={capabilities}
                        onDelete={deleteCamera}
                        onRefresh={refetch}
                    />
                )}

                {!(loading || universal.loading || uiMode === 'loading') && currentView === 'cameras' && uiMode === 'universal' && (
                    <UniversalDeviceList
                        devices={universal.devices}
                        loading={universal.loading}
                        error={universal.error}
                        onRefresh={universal.refetch}
                    />
                )}

                {/* Plugin store view */}
                {!loading && currentView === 'plugins' && (
                    <div className="flex flex-col items-center justify-center py-24 text-center border border-white/10 rounded-xl bg-white/5 mx-auto max-w-2xl mt-8">
                        <div className="text-4xl mb-4 opacity-50">🔌</div>
                        <h2 className="text-xl font-bold text-white mb-2">Integraciones todavía no disponibles</h2>
                        <p className="text-gray-400 text-sm max-w-md">
                            La funcionalidad de conectar cuentas cloud de terceros está en desarrollo en el core V4-R1. Pronto podrás añadir plugins.
                        </p>
                    </div>
                )}
            </main>

            {/* ── Add camera modal ───────────────────────────────────────── */}
            {showAddModal && (
                <AddCameraModal
                    onClose={() => setShowAddModal(false)}
                    onAdd={handleAddCamera}
                />
            )}
        </div>
    );
}
