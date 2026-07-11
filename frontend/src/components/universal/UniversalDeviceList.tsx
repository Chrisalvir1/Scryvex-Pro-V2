import { useState } from 'react';
import type { DeviceModelView } from '@scryvex/contracts';

export function UniversalDeviceList({ devices, loading, error, onRefresh }: { 
    devices: DeviceModelView[], 
    loading: boolean, 
    error: string | null,
    onRefresh: () => void 
}) {
    const [selectedId, setSelectedId] = useState<string | null>(devices[0]?.id ?? null);
    
    const selectedDevice = devices.find(d => d.id === selectedId);

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
        <div className="flex h-[800px] border border-white/10 rounded-xl overflow-hidden bg-black/40">
            {/* Sidebar */}
            <div className="w-80 border-r border-white/10 flex flex-col bg-black/20">
                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <h2 className="font-bold text-sm text-gray-200">Universal Devices</h2>
                    <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">{devices.length}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {devices.map(device => (
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

                        {/* Settings */}
                        <section className="bg-white/5 border border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-gray-300 mb-4">Settings ({selectedDevice.settings.length})</h3>
                            <div className="space-y-1">
                                {selectedDevice.settings.length === 0 && <p className="text-sm text-gray-500">No settings available.</p>}
                                {selectedDevice.settings.map(s => (
                                    <div key={s.key} className="flex justify-between p-2 rounded hover:bg-white/5 text-sm">
                                        <div className="w-1/3 font-medium text-gray-300">{s.title || s.key}</div>
                                        <div className="w-2/3 text-gray-500 truncate flex items-center gap-2">
                                            {s.secret ? (
                                                <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded">REDACTED</span>
                                            ) : (
                                                <span className="font-mono text-xs">{String(s.value ?? 'null')}</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
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
                    <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
                        Select a device to view universal projection.
                    </div>
                )}
            </div>
        </div>
    );
}
