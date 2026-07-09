import React, { useState } from 'react';
import { useScryptedCameras } from './hooks/useScryptedCameras';
import { CameraList } from './components/CameraList';
import { AddCameraModal } from './components/AddCameraModal';
import type { CreateCameraInput } from './types/camera';

// ── Connection state indicator ────────────────────────────────────────────────
const CONNECTION_BADGE: Record<string, { label: string; className: string }> = {
    connected:    { label: 'Conectado', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    connecting:   { label: 'Conectando…', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    reconnecting: { label: 'Reconectando…', className: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
    error:        { label: 'Sin conexión', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

export default function App() {
    const {
        cameras,
        loading,
        connectionState,
        error,
        recentEvents,
        addCamera,
        deleteCamera,
    } = useScryptedCameras();

    const [showAddModal, setShowAddModal] = useState(false);

    const handleAddCamera = async (input: CreateCameraInput) => {
        await addCamera(input);
    };

    const badge = CONNECTION_BADGE[connectionState] ?? CONNECTION_BADGE.error;

    return (
        <div className="min-h-screen bg-[#080c10] text-white">

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
                            {cameras.length} cámara{cameras.length !== 1 ? 's' : ''}
                        </span>

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
                {loading && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        <p className="text-sm text-gray-500">Cargando cámaras desde el servidor…</p>
                    </div>
                )}

                {/* Error state — server unreachable */}
                {!loading && error && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <span className="text-4xl">⚠️</span>
                        <div>
                            <h2 className="text-lg font-semibold text-red-400 mb-1">Error de conexión con el servidor</h2>
                            <p className="text-sm text-gray-500 max-w-sm">{error}</p>
                        </div>
                        <p className="text-xs text-gray-700">
                            El servidor Scryvex Pro puede estar iniciando. La interfaz se reconectará automáticamente.
                        </p>
                    </div>
                )}

                {/* Normal state — camera list or empty state */}
                {!loading && !error && (
                    <CameraList
                        cameras={cameras}
                        events={recentEvents}
                        onDelete={deleteCamera}
                    />
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
