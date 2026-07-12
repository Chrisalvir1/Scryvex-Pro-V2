import { useState, useEffect } from 'react';
import { useScryptedCameras } from './hooks/useScryptedCameras';
import { useUniversalDevices } from './hooks/useUniversalDevices';
import { LegacyCameraPanel } from './components/LegacyCameraPanel';
import { UniversalDeviceList } from './components/universal/UniversalDeviceList';
import { ScryvexCameraList } from './components/universal/ScryvexCameraList';
import { AddCameraModal } from './components/AddCameraModal';
import { useScryvexCameras } from './hooks/useScryvexCameras';
import { useMediaCapabilities } from './hooks/useMediaCapabilities';
import type { CreateCameraInput } from './types/camera';
import { apiUrl } from './lib/ingress-url';

const CONNECTION_BADGE: Record<string, { label: string; className: string }> = {
    connected:    { label: 'En Vivo', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    connecting:   { label: 'Conectando…', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    reconnecting: { label: 'Reconectando…', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    error:        { label: 'Solo REST ✓', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

function DiagnosticsBanner() {
    const { response: sysResponse, capabilities, refreshCapabilities } = useMediaCapabilities();
    
    return (
        <>
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
                            ].filter(Boolean).join(' y ')}) no están disponibles o fallaron.
                        </span>
                        <button onClick={refreshCapabilities} className="px-3 py-1 bg-red-500/20 hover:bg-red-500/40 rounded transition-colors text-xs font-bold uppercase tracking-wider">Reintentar</button>
                    </div>
                </div>
            )}
        </>
    );
}

function UniversalApp() {
    const { devices, loading: loadingDevices, error: errorDevices, refetch: refetchDevices } = useUniversalDevices();
    const { cameras, loading, error, refetch, addCamera } = useScryvexCameras();
    const [currentView, setCurrentView] = useState<'cameras' | 'scrypted' | 'plugins'>('cameras');
    const [showAddModal, setShowAddModal] = useState(false);

    return (
        <div className="min-h-screen bg-[#080c10] text-white flex flex-col">
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
                        <span className="text-xs text-gray-600 font-mono">
                            {cameras.length} cámara{cameras.length !== 1 ? 's' : ''} en Scryvex
                        </span>

                        <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 mx-4">
                            <button
                                onClick={() => setCurrentView('cameras')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-2 ${currentView === 'cameras' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                Cámaras Nativas
                            </button>
                            <button
                                onClick={() => setCurrentView('scrypted')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-2 ${currentView === 'scrypted' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                Scrypted Interno
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 flex flex-col w-full h-full">
                {loading && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 flex-1">
                        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-500">Cargando dispositivos universales...</p>
                    </div>
                )}
                {!loading && error && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center flex-1">
                        <span className="text-4xl">⚠️</span>
                        <h2 className="text-lg font-semibold text-red-400">Error</h2>
                        <p className="text-sm text-gray-500 max-w-sm">{error}</p>
                    </div>
                )}
                {!loading && !error && currentView === 'cameras' && (
                    <div className="flex-1 overflow-hidden h-full">
                        <ScryvexCameraList
                            cameras={cameras}
                            loading={loading}
                            error={error}
                            onRefresh={refetch}
                            onAddCamera={() => setShowAddModal(true)}
                        />
                    </div>
                )}
                {!loadingDevices && !errorDevices && currentView === 'scrypted' && (
                    <div className="flex-1 overflow-hidden h-full">
                        <UniversalDeviceList
                            devices={devices}
                            loading={loadingDevices}
                            error={errorDevices}
                            onRefresh={refetchDevices}
                        />
                    </div>
                )}
            </main>
            {showAddModal && <AddCameraModal onClose={() => setShowAddModal(false)} onAdd={addCamera} />}
        </div>
    );
}

function LegacyApp() {
    const { cameras, loading, connectionState, error, addCamera, deleteCamera, refetch } = useScryptedCameras();
    const [showAddModal, setShowAddModal] = useState(false);
    
    const handleAddCamera = async (input: CreateCameraInput) => {
        await addCamera(input);
    };

    const badge = CONNECTION_BADGE[connectionState] ?? CONNECTION_BADGE.error;

    return (
        <div className="min-h-screen bg-[#080c10] text-white">
            <DiagnosticsBanner />
            <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#080c10]/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-sm font-black">S</div>
                        <h1 className="text-xl font-bold tracking-tight">Scryvex <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">Pro</span></h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded-full border ${badge.className}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`} />
                            {badge.label}
                        </span>
                        <span className="text-xs text-gray-600 font-mono">{cameras.length} dispositivo{cameras.length !== 1 ? 's' : ''}</span>
                        <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 mx-4">
                            <span className="px-4 py-1.5 text-xs font-bold rounded-md bg-white/10 text-white flex items-center gap-2">
                                Dispositivos <span className="bg-orange-500/20 text-orange-400 px-1 py-0.5 rounded text-[8px]">LEGACY</span>
                            </span>
                        </div>
                        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.3)]">
                            <span>+</span><span>Agregar Cámara</span>
                        </button>
                    </div>
                </div>
            </header>
            <main className="max-w-7xl mx-auto px-6 py-8">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-500">Cargando...</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <span className="text-4xl">⚠️</span>
                        <h2 className="text-lg font-semibold text-red-400">Error</h2>
                        <p className="text-sm text-gray-500 max-w-sm">{error}</p>
                    </div>
                ) : (
                    <LegacyCameraPanel cameras={cameras} onDelete={deleteCamera} onRefresh={refetch} />
                )}
            </main>
            {showAddModal && <AddCameraModal onClose={() => setShowAddModal(false)} onAdd={handleAddCamera} />}
        </div>
    );
}

export default function App() {
    const [uiMode, setUiMode] = useState<'universal' | 'legacy' | 'loading'>('loading');

    useEffect(() => {
        fetch(apiUrl('/api/system/ui-config'))
            .then(res => res.json())
            .then(data => setUiMode(data.cameraUi || 'universal'))
            .catch(() => setUiMode('universal'));
    }, []);

    if (uiMode === 'loading') {
        return (
            <div className="min-h-screen bg-[#080c10] text-white flex items-center justify-center flex-col gap-4">
                <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                <p className="text-sm text-gray-500">Iniciando Scryvex Pro...</p>
            </div>
        );
    }

    return uiMode === 'universal' ? <UniversalApp /> : <LegacyApp />;
}
