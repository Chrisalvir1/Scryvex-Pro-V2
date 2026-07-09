import React, { useState, useEffect } from 'react';

type Plugin = {
    id: string;
    name: string;
    protocol: string;
    description: string;
    version: string;
    icon: string;
    installed: boolean;
};

export function PluginStore() {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionState, setActionState] = useState<Record<string, 'installing' | 'removing'>>({});

    useEffect(() => {
        fetchPlugins();
    }, []);

    const fetchPlugins = async () => {
        try {
            const res = await fetch('/api/plugins');
            if (res.ok) {
                setPlugins(await res.json());
            }
        } catch (err) {
            console.error('Error fetching plugins:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleInstall = async (id: string) => {
        setActionState(prev => ({ ...prev, [id]: 'installing' }));
        try {
            const res = await fetch(`/api/plugins/${id}/install`, { method: 'POST' });
            if (res.ok) {
                await fetchPlugins();
            }
        } catch (err) {
            console.error('Error installing plugin:', err);
        } finally {
            setActionState(prev => {
                const copy = { ...prev };
                delete copy[id];
                return copy;
            });
        }
    };

    const handleRemove = async (id: string) => {
        setActionState(prev => ({ ...prev, [id]: 'removing' }));
        try {
            const res = await fetch(`/api/plugins/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await fetchPlugins();
            }
        } catch (err) {
            console.error('Error removing plugin:', err);
        } finally {
            setActionState(prev => {
                const copy = { ...prev };
                delete copy[id];
                return copy;
            });
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    return (
        <div className="p-6 h-full flex flex-col overflow-hidden">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2">Tienda de Integraciones</h1>
                <p className="text-gray-400">Descarga e instala plugins para añadir soporte nativo a nuevas cámaras y ecosistemas.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pb-10 pr-2">
                {plugins.map(p => (
                    <div key={p.id} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col transition hover:bg-white/10">
                        <div className="flex items-start justify-between mb-4">
                            <img src={p.icon} alt={p.name} className="w-12 h-12 object-contain" />
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/30 text-gray-300">
                                v{p.version}
                            </span>
                        </div>
                        
                        <h3 className="text-lg font-semibold text-white mb-1">{p.name}</h3>
                        <span className="text-[10px] text-blue-400 font-bold tracking-wider uppercase mb-3">
                            {p.protocol}
                        </span>
                        
                        <p className="text-sm text-gray-400 mb-6 flex-1 line-clamp-3">
                            {p.description}
                        </p>
                        
                        <div className="mt-auto">
                            {p.installed ? (
                                <div className="flex gap-2">
                                    <button
                                        disabled
                                        className="flex-1 py-2 text-sm font-semibold rounded-lg bg-green-500/10 text-green-500 border border-green-500/20"
                                    >
                                        ✓ Instalado
                                    </button>
                                    {(p.id !== 'rtsp' && p.id !== 'onvif') && (
                                        <button
                                            onClick={() => handleRemove(p.id)}
                                            disabled={actionState[p.id] === 'removing'}
                                            className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors border border-red-500/20 disabled:opacity-50"
                                        >
                                            {actionState[p.id] === 'removing' ? '...' : 'Eliminar'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <button
                                    onClick={() => handleInstall(p.id)}
                                    disabled={actionState[p.id] === 'installing'}
                                    className="w-full py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
                                >
                                    {actionState[p.id] === 'installing' ? 'Instalando...' : 'Descargar'}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
