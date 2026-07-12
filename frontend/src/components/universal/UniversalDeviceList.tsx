import { useState, useEffect } from 'react';
import type { DeviceModelView } from '@scryvex/contracts';
import { WebRTCPlayer } from './WebRTCPlayer';
import { apiUrl } from '../../lib/ingress-url';

export function UniversalDeviceList({ devices, loading, error, onRefresh }: { 
    devices: DeviceModelView[], 
    loading: boolean, 
    error: string | null,
    onRefresh: () => void 
}) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showSystemDevices, setShowSystemDevices] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editValues, setEditValues] = useState<Record<string, any>>({});
    const [savingSetting, setSavingSetting] = useState<string | null>(null);

    const cameraDevices = devices.filter(device =>
        device.interfaces.includes('Camera')
        || device.interfaces.includes('VideoCamera')
        || device.interfaces.includes('Doorbell')
    );
    const visibleDevices = showSystemDevices ? devices : cameraDevices;
    
    // Reset edit values on selection change
    useEffect(() => {
        setEditValues({});
    }, [selectedId]);

    // Auto-selection
    useEffect(() => {
        if (!visibleDevices.length) {
            setSelectedId(null);
            return;
        }
        if (!selectedId || !visibleDevices.find(d => d.id === selectedId)) {
            setSelectedId(visibleDevices[0].id);
        }
    }, [visibleDevices, selectedId]);

    const selectedDevice = visibleDevices.find(d => d.id === selectedId);

    const handleSaveSetting = async (key: string, value: any) => {
        if (!selectedDevice) return;
        setSavingSetting(key);
        try {
            const res = await fetch(apiUrl(`/api/scrypted/devices/${selectedDevice.id}/settings`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ key, value })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(`Error al guardar: ${data.error || 'Desconocido'}`);
            } else {
                onRefresh();
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setSavingSetting(null);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-400 animate-pulse">Loading universal devices...</div>;
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-400 mb-4">{error}</p>
                <button onClick={onRefresh} className="px-4 py-2 bg-red-500/20 text-red-300 rounded hover:bg-red-500/40">Retry</button>
            </div>
        );
    }

    return (
        <div className="flex h-[850px] border border-white/10 rounded-xl overflow-hidden bg-black/40">
            {/* Sidebar */}
            <div className="w-80 border-r border-white/10 flex flex-col bg-black/20">
                <div className="p-4 border-b border-white/10 flex flex-col gap-3 bg-white/5">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="font-bold text-sm text-gray-200">Cámaras de Scrypted</h2>
                            <p className="text-[11px] text-gray-500 mt-0.5">Solo dispositivos de cámara reales</p>
                        </div>
                        <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{cameraDevices.length}</span>
                    </div>
                    
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(37,99,235,0.2)]"
                    >
                        <span>+</span>
                        <span>Agregar Cámara</span>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {!showSystemDevices && cameraDevices.length === 0 && (
                        <div className="m-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                            <p className="font-semibold">Aún no hay cámaras en Scrypted.</p>
                            <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
                                Esta vista solo muestra cámaras añadidas mediante un plugin de Scrypted, por ejemplo ONVIF u RTSP Camera.
                            </p>
                            <button
                                type="button"
                                onClick={() => setShowSystemDevices(true)}
                                className="mt-3 text-xs font-semibold text-amber-300 hover:text-amber-200"
                            >
                                Ver servicios técnicos ({devices.length})
                            </button>
                        </div>
                    )}
                    {showSystemDevices && (
                        <button
                            type="button"
                            onClick={() => setShowSystemDevices(false)}
                            className="m-2 text-left text-xs font-semibold text-blue-300 hover:text-blue-200"
                        >
                            ← Volver a cámaras ({cameraDevices.length})
                        </button>
                    )}
                    {visibleDevices.map(device => (
                        <button
                            key={device.id}
                            onClick={() => setSelectedId(device.id)}
                            className={`w-full text-left px-3 py-3 rounded-lg transition-all border ${selectedId === device.id ? 'bg-blue-600/20 border-blue-500/50' : 'bg-transparent border-transparent hover:bg-white/5'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-sm text-gray-100 truncate pr-2">{device.name}</span>
                                <span className="text-[10px] bg-white/10 text-gray-400 px-1.5 py-0.5 rounded shrink-0">{device.plugin}</span>
                            </div>
                            <div className="text-xs text-gray-500 truncate">{device.manufacturer} {device.model}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Detail View */}
            <div className="flex-1 flex flex-col bg-[#050505] overflow-y-auto p-8">
                {selectedDevice ? (
                    <div className="max-w-4xl w-full mx-auto space-y-8">
                        <header className="flex justify-between items-end pb-4 border-b border-white/10">
                            <div>
                                <h1 className="text-2xl font-bold text-white mb-1">{selectedDevice.name}</h1>
                                <p className="text-sm text-gray-400">{selectedDevice.manufacturer} • {selectedDevice.model}</p>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-gray-500 mb-1">Status</div>
                                <div className="px-3 py-1 rounded border bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs font-bold uppercase tracking-wider">
                                    {selectedDevice.diagnostics.status}
                                </div>
                            </div>
                        </header>

                        {/* Reproductor de Video Stream Original */}
                        {(selectedDevice.interfaces.includes('VideoCamera') || selectedDevice.interfaces.includes('Camera')) && (
                            <section className="bg-black border border-white/10 rounded-xl overflow-hidden aspect-video flex items-center justify-center relative shadow-2xl">
                                <WebRTCPlayer cameraId={selectedDevice.id} />
                            </section>
                        )}

                        {selectedDevice.diagnostics.partial && selectedDevice.diagnostics.readErrors?.length > 0 && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex gap-3 text-sm">
                                <span className="text-xl">⚠️</span>
                                <div>
                                    <h3 className="font-bold text-yellow-400 mb-1">Información parcial</h3>
                                    <ul className="text-yellow-200/80 list-disc list-inside">
                                        {selectedDevice.diagnostics.readErrors.map((err, idx) => (
                                            <li key={idx}>No fue posible leer {err.source}: {err.code} - {err.message}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-6">
                            {/* Capabilities */}
                            <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Capabilities
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {selectedDevice.capabilities.map(c => (
                                        <span key={c} className="px-2.5 py-1 bg-white/10 text-xs rounded text-gray-200">{c}</span>
                                    ))}
                                    {selectedDevice.capabilities.length === 0 && <span className="text-xs text-gray-500">None detected</span>}
                                </div>
                            </section>

                            {/* Interfaces */}
                            <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-blue-400"></span> Interfaces
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {selectedDevice.interfaces.map(i => (
                                        <span key={i} className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 text-xs rounded text-blue-300">{i}</span>
                                    ))}
                                    {selectedDevice.interfaces.length === 0 && <span className="text-xs text-gray-500">None</span>}
                                </div>
                            </section>
                        </div>

                        {/* Settings Form */}
                        <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-gray-300 mb-4">Settings ({selectedDevice.settings.length})</h3>
                            <div className="space-y-3">
                                {selectedDevice.settings.length === 0 && <p className="text-sm text-gray-500">No settings available.</p>}
                                {selectedDevice.settings.map(s => {
                                    const isEditing = !s.readonly;
                                    const value = editValues[s.key] !== undefined ? editValues[s.key] : s.value;

                                    return (
                                        <div key={s.key} className="flex flex-col md:flex-row md:items-center justify-between p-3 rounded bg-white/[0.02] border border-white/[0.04] text-sm gap-2">
                                            <div className="md:w-1/3 flex flex-col">
                                                <span className="font-semibold text-gray-300">{s.title || s.key}</span>
                                                <span className="text-[10px] text-gray-500 font-mono">{s.key}</span>
                                            </div>
                                            <div className="md:w-2/3 flex items-center gap-3">
                                                {!isEditing ? (
                                                    s.secret ? (
                                                        <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded">REDACTED</span>
                                                    ) : (
                                                        <span className="font-mono text-xs text-gray-400 break-all">{String(s.value ?? 'null')}</span>
                                                    )
                                                ) : s.type === 'boolean' ? (
                                                    <input 
                                                        type="checkbox"
                                                        checked={value === 'true' || value === true}
                                                        disabled={savingSetting === s.key}
                                                        onChange={(e) => {
                                                            const val = e.target.checked;
                                                            setEditValues(p => ({ ...p, [s.key]: val }));
                                                            handleSaveSetting(s.key, val);
                                                        }}
                                                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 bg-black"
                                                    />
                                                ) : s.type === 'choices' ? (
                                                    <select
                                                        value={String(value ?? '')}
                                                        disabled={savingSetting === s.key}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setEditValues(p => ({ ...p, [s.key]: val }));
                                                            handleSaveSetting(s.key, val);
                                                        }}
                                                        className="bg-black text-white border border-white/20 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                                                    >
                                                        {s.choices?.map((c: string) => (
                                                            <option key={c} value={c}>{c}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <div className="flex gap-2 w-full">
                                                        <input 
                                                            type={s.secret ? 'password' : s.type === 'integer' || s.type === 'number' ? 'number' : 'text'}
                                                            placeholder={s.secret ? '(Secret Configured)' : ''}
                                                            value={s.secret && editValues[s.key] === undefined ? '' : String(value ?? '')}
                                                            disabled={savingSetting === s.key}
                                                            onChange={(e) => {
                                                                setEditValues(p => ({ ...p, [s.key]: e.target.value }));
                                                            }}
                                                            className="bg-black text-white border border-white/25 rounded px-3 py-1.5 text-xs flex-1 font-mono focus:outline-none focus:border-blue-500"
                                                        />
                                                        <button
                                                            onClick={() => handleSaveSetting(s.key, editValues[s.key])}
                                                            disabled={savingSetting === s.key}
                                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white transition-colors"
                                                        >
                                                            {savingSetting === s.key ? 'Saving...' : 'Save'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Media Options */}
                        <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-gray-300 mb-4">Media Options ({selectedDevice.media.options.length})</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {selectedDevice.media.options.length === 0 && <p className="text-sm text-gray-500">No media options available.</p>}
                                {selectedDevice.media.options.map(m => (
                                    <div key={m.id} className="p-4 border border-white/10 rounded-lg bg-black/20">
                                        <div className="font-bold text-sm text-gray-200 mb-2">{m.name || m.id}</div>
                                        <div className="text-xs text-gray-400 space-y-1">
                                            {m.videoCodec && <div>Video: {m.videoCodec} {m.width}x{m.height} @ {m.fps}fps</div>}
                                            {m.audioCodec && <div>Audio: {m.audioCodec}</div>}
                                            {m.container && <div>Container: {m.container}</div>}
                                            {m.source && <div className="text-[10px] break-all font-mono opacity-50 mt-2">{m.source}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <div className="text-[10px] text-gray-600 font-mono pt-8 pb-4">
                            Revision Hash: {selectedDevice.revision} • ID: {selectedDevice.id}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center px-8 text-center text-gray-500 text-sm">
                        No hay una cámara de Scrypted seleccionada.
                    </div>
                )}
            </div>

            {/* Agregar Cámara Modal */}
            {showAddModal && (
                <AddScryptedCameraModal 
                    devices={devices}
                    onClose={() => setShowAddModal(false)}
                    onRefresh={() => {
                        setShowAddModal(false);
                        onRefresh();
                    }}
                />
            )}
        </div>
    );
}

function AddScryptedCameraModal({ devices, onClose, onRefresh }: { 
    devices: DeviceModelView[], 
    onClose: () => void,
    onRefresh: () => void 
}) {
    const creatorDevices = devices.filter(d => d.interfaces.includes('DeviceCreator'));
    const [selectedCreatorId, setSelectedCreatorId] = useState<string>('');
    const [creatorSettings, setCreatorSettings] = useState<any[]>([]);
    const [formValues, setFormValues] = useState<Record<string, any>>({});
    const [loadingSettings, setLoadingSettings] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedCreatorId) {
            setCreatorSettings([]);
            return;
        }

        const fetchSettings = async () => {
            setLoadingSettings(true);
            setError(null);
            try {
                const res = await fetch(apiUrl(`/api/scrypted/devices/${selectedCreatorId}/creator-settings`));
                if (!res.ok) throw new Error('No se pudieron obtener configuraciones del plugin.');
                const data = await res.json();
                setCreatorSettings(data.settings || []);
                
                // Initialize default form values
                const defaults: Record<string, any> = {};
                data.settings?.forEach((s: any) => {
                    if (s.value !== undefined) defaults[s.key] = s.value;
                });
                setFormValues(defaults);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoadingSettings(false);
            }
        };

        fetchSettings();
    }, [selectedCreatorId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCreatorId) return;
        
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch(apiUrl(`/api/scrypted/devices/${selectedCreatorId}/create-device`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(formValues)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Error al crear el dispositivo.');
            }
            onRefresh();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="bg-[#0f141c] border border-white/10 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
                <header className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <h2 className="text-lg font-bold text-white">Agregar Cámara / Integración</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">✕</button>
                </header>
                
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-4 rounded-lg">
                            {error}
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Plugin Proveedor</label>
                        <select
                            value={selectedCreatorId}
                            onChange={(e) => setSelectedCreatorId(e.target.value)}
                            required
                            className="w-full bg-[#151c27] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        >
                            <option value="">Seleccionar plugin...</option>
                            {creatorDevices.map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.plugin})</option>
                            ))}
                        </select>
                    </div>

                    {loadingSettings && (
                        <div className="py-8 text-center text-xs text-gray-500 animate-pulse">Cargando campos del plugin...</div>
                    )}

                    {!loadingSettings && creatorSettings.length > 0 && (
                        <div className="space-y-4 pt-4 border-t border-white/10">
                            {creatorSettings.map(s => {
                                const val = formValues[s.key] !== undefined ? formValues[s.key] : s.value;
                                return (
                                    <div key={s.key} className="space-y-1.5">
                                        <div className="flex justify-between items-baseline">
                                            <label className="block text-xs font-semibold text-gray-300">{s.title || s.key}</label>
                                            {s.description && (
                                                <span className="text-[10px] text-gray-500 italic max-w-[60%] text-right truncate">{s.description}</span>
                                            )}
                                        </div>
                                        {s.type === 'boolean' ? (
                                            <input 
                                                type="checkbox"
                                                checked={val === 'true' || val === true}
                                                onChange={(e) => setFormValues(p => ({ ...p, [s.key]: e.target.checked }))}
                                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 bg-black"
                                            />
                                        ) : s.type === 'choices' ? (
                                            <select
                                                value={String(val ?? '')}
                                                required={s.required}
                                                onChange={(e) => setFormValues(p => ({ ...p, [s.key]: e.target.value }))}
                                                className="w-full bg-[#151c27] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none"
                                            >
                                                <option value="">Selecciona una opción...</option>
                                                {s.choices?.map((c: string) => (
                                                    <option key={c} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input 
                                                type={s.secret ? 'password' : s.type === 'integer' || s.type === 'number' ? 'number' : 'text'}
                                                required={s.required}
                                                placeholder={s.placeholder || ''}
                                                value={String(val ?? '')}
                                                onChange={(e) => setFormValues(p => ({ ...p, [s.key]: e.target.value }))}
                                                className="w-full bg-[#151c27] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </form>
                
                <footer className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                    <button 
                        type="button"
                        onClick={onClose} 
                        className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={handleSubmit}
                        disabled={submitting || !selectedCreatorId}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white text-xs font-bold rounded-lg shadow-lg"
                    >
                        {submitting ? 'Creando...' : 'Crear Dispositivo'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

