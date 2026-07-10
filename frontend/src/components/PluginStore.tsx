import { useState, useEffect } from 'react';
import type { PluginStatus } from '../types/plugin';
import { apiUrl } from '../lib/ingress-url';

type Plugin = {
    id: string;
    name: string;
    protocol: string;
    description: string;
    version: string;
    icon: string;
    installed: boolean;
};

const assetUrl = (path: string) => {
    const base = import.meta.env.BASE_URL || './';
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
};

export function PluginStore() {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionState, setActionState] = useState<Record<string, 'installing' | 'removing'>>({});

    useEffect(() => {
        const controller = new AbortController();

        async function loadPlugins() {
            try {
                setLoading(true);
                setError(null);

                const url = apiUrl('api/plugins');
                console.info('[API] Plugins URL:', url);

                const response = await fetch(url, {
                    credentials: 'same-origin',
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error(`GET /api/plugins respondió ${response.status}`);
                }

                const data = await response.json();

                const pluginList = Array.isArray(data)
                    ? data
                    : Array.isArray(data.plugins)
                        ? data.plugins
                        : [];

                setPlugins(pluginList);
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    return;
                }
                setError(err instanceof Error ? err.message : 'No se pudo cargar la tienda.');
            } finally {
                setLoading(false);
            }
        }

        void loadPlugins();

        return () => controller.abort();
    }, []);

    const fetchPlugins = async () => {
        try {
            const res = await fetch(apiUrl('api/plugins'));
            if (res.ok) {
                setPlugins(await res.json());
            }
        } catch (err) {
            console.error('Error fetching plugins:', err);
        }
    };

    const handleInstall = async (id: string) => {
        setActionState(prev => ({ ...prev, [id]: 'installing' }));
        try {
            const res = await fetch(apiUrl(`api/plugins/${id}/install`), { method: 'POST' });
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
            const res = await fetch(apiUrl(`api/plugins/${id}`), { method: 'DELETE' });
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
            <div className="p-6">
                <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-white/10 rounded w-1/4"></div>
                    <div className="h-32 bg-white/5 rounded-xl border border-white/5"></div>
                    <div className="h-32 bg-white/5 rounded-xl border border-white/5"></div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
                    <h3 className="text-red-400 font-bold mb-2">No se pudo cargar la tienda</h3>
                    <p className="text-gray-400 text-sm mb-4">{error}</p>
                    <button 
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                        Reintentar
                    </button>
                </div>
            </div>
        );
    }

    if (plugins.length === 0) {
        return (
            <div className="p-6">
                <div className="bg-white/5 border border-white/10 rounded-xl p-8 text-center text-gray-400">
                    No hay integraciones disponibles.
                </div>
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
                            {/* Use the icon URL from the API; fall back to a text avatar on 404 */}
                            <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-white/5 border border-white/10">
                                <img
                                    src={assetUrl(p.icon)}
                                    alt={p.name}
                                    className="w-full h-full object-contain p-1"
                                    onError={(e) => {
                                        // Hide broken image and show the fallback letter avatar
                                        const el = e.currentTarget;
                                        el.style.display = 'none';
                                        const parent = el.parentElement!;
                                        if (!parent.querySelector('.logo-fallback')) {
                                            const span = document.createElement('span');
                                            span.className = 'logo-fallback text-lg font-black text-blue-400';
                                            span.textContent = p.name.charAt(0).toUpperCase();
                                            parent.appendChild(span);
                                        }
                                    }}
                                />
                            </div>
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
