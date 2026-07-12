import { useState, useEffect } from 'react';
import type { Camera } from '../../types/camera';
import { apiUrl } from '../../lib/ingress-url';

export function ScryvexCameraList({ cameras, loading, error, onRefresh, onAddCamera }: { 
    cameras: Camera[], 
    loading: boolean, 
    error: string | null,
    onRefresh: () => void,
    onAddCamera: () => void
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [previewKey, setPreviewKey] = useState<number>(0);
    
    // Auto-selección
    useEffect(() => {
        if (!cameras.length) {
            setSelectedId(null);
            return;
        }
        if (!selectedId || !cameras.find(c => c.id === selectedId)) {
            setSelectedId(cameras[0].id);
        }
    }, [cameras, selectedId]);

    const selectedCamera = cameras.find(c => c.id === selectedId);

    const handleRunProbe = async (id: string) => {
        try {
            await fetch(apiUrl(`/api/cameras/${id}/probe`), { method: 'POST', credentials: 'same-origin' });
            onRefresh();
        } catch (e) {
            console.error('Probe failed:', e);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Seguro que deseas eliminar esta cámara de Scryvex?')) return;
        try {
            await fetch(apiUrl(`/api/cameras/${id}`), { method: 'DELETE', credentials: 'same-origin' });
            onRefresh();
        } catch (e) {
            console.error('Delete failed:', e);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-400 animate-pulse">Cargando cámaras de Scryvex...</div>;
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-400 mb-4">{error}</p>
                <button onClick={onRefresh} className="px-4 py-2 bg-red-500/20 text-red-300 rounded hover:bg-red-500/40">Reintentar</button>
            </div>
        );
    }

    if (cameras.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-center border border-white/10 rounded-xl bg-white/5 mx-auto max-w-2xl mt-8">
                <div className="text-4xl mb-4 opacity-50">📷</div>
                <h2 className="text-xl font-bold text-white mb-2">No hay cámaras en Scryvex</h2>
                <p className="text-gray-400 text-sm max-w-md mb-6">Añade tu primera cámara RTSP u ONVIF de forma independiente.</p>
                <button onClick={onAddCamera} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-colors">
                    + Añadir Cámara
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-[800px] border border-white/10 rounded-xl overflow-hidden bg-black/40">
            {/* Sidebar */}
            <div className="w-80 border-r border-white/10 flex flex-col bg-black/20">
                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <div>
                        <h2 className="font-bold text-sm text-gray-200">Cámaras de Scryvex</h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">Gestión nativa independiente</p>
                    </div>
                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{cameras.length}</span>
                </div>
                <div className="p-2 border-b border-white/10">
                    <button onClick={onAddCamera} className="w-full px-3 py-2 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-400 text-xs font-bold rounded flex items-center justify-center gap-2 transition-colors">
                        <span>+</span> Añadir Cámara
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {cameras.map(camera => (
                        <button
                            key={camera.id}
                            onClick={() => setSelectedId(camera.id)}
                            className={`w-full text-left px-3 py-3 rounded-lg transition-all border ${selectedId === camera.id ? 'bg-blue-600/20 border-blue-500/50' : 'bg-transparent border-transparent hover:bg-white/5'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-sm text-gray-100 truncate pr-2">{camera.name}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${camera.status === 'online' ? 'bg-emerald-500/20 text-emerald-400' : camera.status === 'offline' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                    {camera.status}
                                </span>
                            </div>
                            <div className="text-xs text-gray-500 truncate">{camera.ip}:{camera.port} • {camera.protocol}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Detail View */}
            <div className="flex-1 flex flex-col bg-[#050505] overflow-y-auto p-8">
                {selectedCamera ? (
                    <div className="max-w-4xl w-full mx-auto space-y-8">
                        <header className="flex justify-between items-start pb-4 border-b border-white/10">
                            <div>
                                <h1 className="text-2xl font-bold text-white mb-1">{selectedCamera.name}</h1>
                                <p className="text-sm text-gray-400">{selectedCamera.protocol} • {selectedCamera.ip}:{selectedCamera.port}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setPreviewKey(k => k + 1)} className="px-3 py-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 text-white rounded transition-colors">Recargar Preview</button>
                                <button onClick={() => handleRunProbe(selectedCamera.id)} className="px-3 py-1.5 text-xs font-bold bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/40 text-blue-300 rounded transition-colors">Probar Conexión (Probe)</button>
                                <button onClick={() => handleDelete(selectedCamera.id)} className="px-3 py-1.5 text-xs font-bold bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded transition-colors">Eliminar</button>
                            </div>
                        </header>

                        {selectedCamera.last_error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex gap-3 text-sm">
                                <span className="text-xl">🚨</span>
                                <div>
                                    <h3 className="font-bold text-red-400 mb-1">Error de conexión</h3>
                                    <p className="text-red-200/80">{selectedCamera.last_error}</p>
                                </div>
                            </div>
                        )}
                        
                        {selectedCamera.discovery_status === 'pending' && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex gap-3 text-sm">
                                <span className="text-xl animate-pulse">⏳</span>
                                <div>
                                    <h3 className="font-bold text-yellow-400 mb-1">Diagnóstico en curso</h3>
                                    <p className="text-yellow-200/80">Scryvex está utilizando FFprobe y ONVIF para inspeccionar los flujos de la cámara.</p>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-6">
                            {/* Preview Snapshot */}
                            <section className="col-span-2 md:col-span-1 bg-white/5 border border-white/10 rounded-xl overflow-hidden flex flex-col">
                                <div className="p-3 border-b border-white/10 bg-black/20 flex justify-between items-center">
                                    <h3 className="text-xs font-bold text-gray-300">Preview JPEG</h3>
                                    {selectedCamera.capabilities?.preview?.snapshot ? (
                                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded uppercase font-bold">Soportado</span>
                                    ) : (
                                        <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded uppercase font-bold">No Soportado</span>
                                    )}
                                </div>
                                <div className="flex-1 min-h-[200px] bg-black flex items-center justify-center relative">
                                    {selectedCamera.capabilities?.preview?.snapshot ? (
                                        <img 
                                            key={previewKey}
                                            src={apiUrl(`/api/cameras/${selectedCamera.id}/preview?t=${previewKey}`)} 
                                            alt="Camera Preview" 
                                            className="w-full h-full object-contain"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                target.onerror = null; // prevent loop
                                                target.src = '';
                                                target.parentElement!.innerHTML = '<div class="text-xs text-red-400 p-4 text-center">Error al cargar preview real</div>';
                                            }}
                                        />
                                    ) : (
                                        <div className="text-xs text-gray-600">Sin preview disponible</div>
                                    )}
                                </div>
                            </section>

                            {/* Info */}
                            <div className="space-y-6">
                                <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                                    <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-blue-400"></span> Video Profiles Detectados
                                    </h3>
                                    <div className="space-y-3">
                                        {selectedCamera.capabilities?.video?.profiles?.map(p => (
                                            <div key={p.id} className="bg-black/40 border border-white/5 rounded-lg p-3 text-xs flex justify-between items-center">
                                                <div>
                                                    <div className="font-bold text-gray-200">{p.name || p.id}</div>
                                                    <div className="text-gray-500 mt-1">{p.width}x{p.height} • {p.fps}fps</div>
                                                </div>
                                                <div className="flex gap-1">
                                                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-gray-300">{p.normalizedCodec || p.videoCodec}</span>
                                                    {p.audioCodec && <span className="bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">{p.audioCodec}</span>}
                                                </div>
                                            </div>
                                        ))}
                                        {(!selectedCamera.capabilities?.video?.profiles || selectedCamera.capabilities.video.profiles.length === 0) && (
                                            <div className="text-xs text-gray-500 italic">No se detectaron perfiles. Probar conexión para actualizar.</div>
                                        )}
                                    </div>
                                </section>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                        Selecciona una cámara para ver sus detalles
                    </div>
                )}
            </div>
        </div>
    );
}
