import React, { useState } from 'react';
import type { CreateCameraInput, CameraProtocol } from '../types/camera';
import { apiUrl } from '../lib/ingress-url';

const assetUrl = (path: string) => {
    const base = import.meta.env.BASE_URL || './';
    return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
};

const RingLogo = () => <img src={assetUrl('logos/ring.png')} alt="Ring" className="w-9 h-9 object-contain" />;
const WyzeLogo = () => <img src={assetUrl('logos/wyze.png')} alt="Wyze" className="w-9 h-9 object-contain" />;
const TapoLogo = () => <img src={assetUrl('logos/tapo.jpg')} alt="Tapo" className="w-9 h-9 object-contain" />;
const TuyaLogo = () => <img src={assetUrl('logos/tuya.png')} alt="Tuya" className="w-9 h-9 object-contain" />;
const EzvizLogo = () => <img src={assetUrl('logos/ezviz.png')} alt="EZVIZ" className="w-9 h-9 object-contain" />;
const HikvisionLogo = () => <img src={assetUrl('logos/hikvision.png')} alt="Hikvision" className="w-9 h-9 object-contain" />;
const ReoLogo = () => <img src={assetUrl('logos/reolink.png')} alt="Reolink" className="w-9 h-9 object-contain" />;
const DahuaLogo = () => <img src={assetUrl('logos/dahua.png')} alt="Dahua" className="w-9 h-9 object-contain" />;
const GoogleNestLogo = () => <img src={assetUrl('logos/google-nest.png')} alt="Google Nest" className="w-9 h-9 object-contain" />;
const ArloLogo = () => <img src={assetUrl('logos/arlo.png')} alt="Arlo" className="w-9 h-9 object-contain" />;

// ── Integration definitions ───────────────────────────────────────────────────
type IntegrationConfig = {
    id: string;
    name: string;
    description: string;
    logo: React.ReactNode;
    color: string;
    fields: { key: string; label: string; placeholder: string; type?: string }[];
};

const INTEGRATIONS: IntegrationConfig[] = [
    {
        id: 'ring',
        name: 'Ring',
        description: 'Amazon Ring doorbells & cameras',
        logo: <RingLogo />,
        color: 'border-blue-500/40 bg-blue-500/10',
        fields: [
            { key: 'email', label: 'Email de cuenta Ring', placeholder: 'tu@email.com', type: 'email' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
            { key: 'twofa', label: 'Código 2FA (si aplica)', placeholder: '123456' },
        ],
    },
    {
        id: 'wyze',
        name: 'Wyze',
        description: 'Wyze Cam & doorbells',
        logo: <WyzeLogo />,
        color: 'border-cyan-500/40 bg-cyan-500/10',
        fields: [
            { key: 'email', label: 'Email de cuenta Wyze', placeholder: 'tu@email.com', type: 'email' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
            { key: 'apikey', label: 'API Key (opcional)', placeholder: 'wyze-api-key...' },
        ],
    },
    {
        id: 'tapo',
        name: 'Tapo / TP-Link',
        description: 'Cámaras TP-Link Tapo vía RTSP local',
        logo: <TapoLogo />,
        color: 'border-green-500/40 bg-green-500/10',
        fields: [
            { key: 'ip', label: 'IP de la cámara Tapo', placeholder: '192.168.1.X' },
            { key: 'username', label: 'Usuario Tapo', placeholder: 'admin' },
            { key: 'password', label: 'Contraseña Tapo', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'tuya',
        name: 'Tuya Smart',
        description: 'Ecosistema Tuya (cámaras genéricas)',
        logo: <TuyaLogo />,
        color: 'border-orange-500/40 bg-orange-500/10',
        fields: [
            { key: 'accessKey', label: 'Access ID (IoT Platform)', placeholder: 'xxxxxx' },
            { key: 'secretKey', label: 'Access Secret', placeholder: '••••••••', type: 'password' },
            { key: 'region', label: 'Región (us/eu/cn)', placeholder: 'us' },
        ],
    },
    {
        id: 'ezviz',
        name: 'EZVIZ',
        description: 'Hikvision EZVIZ cloud cameras',
        logo: <EzvizLogo />,
        color: 'border-red-500/40 bg-red-500/10',
        fields: [
            { key: 'username', label: 'Usuario EZVIZ', placeholder: 'tu@email.com' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'hikvision',
        name: 'Hikvision',
        description: 'Cámaras NVR/IP Hikvision locales',
        logo: <HikvisionLogo />,
        color: 'border-red-700/40 bg-red-700/10',
        fields: [
            { key: 'ip', label: 'IP del NVR / Cámara', placeholder: '192.168.1.X' },
            { key: 'port', label: 'Puerto (ONVIF)', placeholder: '8000' },
            { key: 'username', label: 'Usuario', placeholder: 'admin' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'reolink',
        name: 'Reolink',
        description: 'Cámaras Reolink vía API local',
        logo: <ReoLogo />,
        color: 'border-orange-400/40 bg-orange-400/10',
        fields: [
            { key: 'ip', label: 'IP de la cámara Reolink', placeholder: '192.168.1.X' },
            { key: 'username', label: 'Usuario', placeholder: 'admin' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'dahua',
        name: 'Dahua',
        description: 'NVR/IP Dahua vía ONVIF',
        logo: <DahuaLogo />,
        color: 'border-blue-700/40 bg-blue-700/10',
        fields: [
            { key: 'ip', label: 'IP del NVR / Cámara', placeholder: '192.168.1.X' },
            { key: 'username', label: 'Usuario', placeholder: 'admin' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'nest',
        name: 'Google Nest',
        description: 'SDM API via OAuth 2.0',
        logo: <GoogleNestLogo />,
        color: 'border-blue-400/40 bg-blue-400/10',
        fields: [
            { key: 'projectId', label: 'Project ID (Device Access)', placeholder: 'enterprise/xxxxx' },
            { key: 'clientId', label: 'GCP Client ID', placeholder: 'xxxxxxxx.apps.googleusercontent.com' },
            { key: 'clientSecret', label: 'GCP Client Secret', placeholder: '••••••••', type: 'password' },
        ],
    },
    {
        id: 'arlo',
        name: 'Arlo',
        description: 'Arlo Pro cloud cameras',
        logo: <ArloLogo />,
        color: 'border-teal-500/40 bg-teal-500/10',
        fields: [
            { key: 'email', label: 'Email de cuenta Arlo', placeholder: 'tu@email.com', type: 'email' },
            { key: 'password', label: 'Contraseña', placeholder: '••••••••', type: 'password' },
        ],
    },
];

// ── RTSP URL validator ────────────────────────────────────────────────────────
function validateRtspUrl(url: string): string | null {
    if (!url) return null;
    if (!url.startsWith('rtsp://')) return 'La URL debe comenzar con rtsp://';
    try { new URL(url); return null; } catch { return 'Formato de URL inválido'; }
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
    onClose: () => void;
    onAdd: (input: CreateCameraInput) => Promise<void>;
}

type Tab = 'local' | 'integrations';
type LocalSubTab = 'rtsp' | 'onvif';

export function AddCameraModal({ onClose, onAdd }: Props) {
    const [tab, setTab]               = useState<Tab>('local');
    const [localSub, setLocalSub]     = useState<LocalSubTab>('rtsp');
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState<string | null>(null);

    // Which integration is expanded
    const [activeIntegration, setActiveIntegration] = useState<string | null>(null);
    // Per-integration field values
    const [integrationFields, setIntegrationFields] = useState<Record<string, Record<string, string>>>({});
    const [intSaving, setIntSaving]   = useState(false);
    const [intSuccess, setIntSuccess] = useState<string | null>(null);

    // ── RTSP fields ────────────────────────────────────────────────────────────
    const [rtspName, setRtspName]   = useState('');
    const [rtspUrl, setRtspUrl]     = useState('');
    const [rtspUser, setRtspUser]   = useState('');
    const [rtspPass, setRtspPass]   = useState('');
    const rtspUrlError              = rtspUrl ? validateRtspUrl(rtspUrl) : null;

    // ── ONVIF fields ───────────────────────────────────────────────────────────
    const [onvifName, setOnvifName] = useState('');
    const [onvifIp, setOnvifIp]     = useState('');
    const [onvifPort, setOnvifPort] = useState('8000');
    const [onvifUser, setOnvifUser] = useState('admin');
    const [onvifPass, setOnvifPass] = useState('');

    const handleSave = async () => {
        setSaveError(null);
        const input: CreateCameraInput = localSub === 'rtsp'
            ? {
                name:     rtspName,
                ip:       (() => { try { return new URL(rtspUrl.replace('rtsp://', 'http://')).hostname; } catch { return rtspUrl; } })(),
                port:     554,
                rtsp_url: rtspUrl,
                username: rtspUser || undefined,
                password: rtspPass || undefined,
                protocol: 'RTSP' as CameraProtocol,
            }
            : {
                name:       onvifName,
                ip:         onvifIp,
                port:       554,
                onvif_port: parseInt(onvifPort) || 8000,
                username:   onvifUser || undefined,
                password:   onvifPass || undefined,
                protocol:   'ONVIF' as CameraProtocol,
            };

        setSaving(true);
        try {
            await onAdd(input);
            onClose();
        } catch (err: unknown) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const handleIntegrationConnect = async (integrationId: string) => {
        setIntSaving(true);
        setIntSuccess(null);
        try {
            const fields = integrationFields[integrationId] ?? {};
            const res = await fetch(apiUrl('api/integrations/connect'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ provider: integrationId, credentials: fields }),
            });
            if (res.ok) {
                setIntSuccess(integrationId);
            } else {
                const body = await res.json().catch(() => ({ error: 'Error desconocido' }));
                setSaveError(body.error ?? 'Fallo al conectar');
            }
        } catch {
            setSaveError('No se pudo conectar con el servidor');
        } finally {
            setIntSaving(false);
        }
    };

    const setField = (integrationId: string, key: string, value: string) => {
        setIntegrationFields(prev => ({
            ...prev,
            [integrationId]: { ...(prev[integrationId] ?? {}), [key]: value },
        }));
    };

    const rtspValid = rtspName.trim() && rtspUrl.trim() && !rtspUrlError;
    const onvifValid = onvifName.trim() && onvifIp.trim();
    const canSave = localSub === 'rtsp' ? rtspValid : onvifValid;

    const activeIntData = INTEGRATIONS.find(i => i.id === activeIntegration);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <div className="bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-white/10 bg-white/[0.02] flex-shrink-0">
                    <h2 className="text-xl font-bold tracking-tight">Agregar Cámara</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-all"
                    >✕</button>
                </div>

                {/* Main tabs */}
                <div className="flex border-b border-white/10 bg-black/20 flex-shrink-0">
                    <button
                        onClick={() => setTab('local')}
                        className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                            tab === 'local'
                                ? 'text-blue-400 border-b-2 border-blue-500 bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                        }`}
                    >📡 Red Local</button>
                    <button
                        onClick={() => { setTab('integrations'); setActiveIntegration(null); }}
                        className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                            tab === 'integrations'
                                ? 'text-purple-400 border-b-2 border-purple-500 bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                        }`}
                    >🔌 Integraciones</button>
                </div>

                <div className="p-5 overflow-y-auto flex-1">

                    {/* ── Local tab ──────────────────────────────────────── */}
                    {tab === 'local' && (
                        <div className="flex flex-col gap-4">
                            <div className="flex gap-2 bg-white/5 p-1 rounded-lg w-fit">
                                {(['rtsp', 'onvif'] as LocalSubTab[]).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setLocalSub(s)}
                                        className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                                            localSub === s
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'text-gray-400 hover:text-white'
                                        }`}
                                    >{s.toUpperCase()}</button>
                                ))}
                            </div>

                            {localSub === 'rtsp' && (
                                <div className="flex flex-col gap-3">
                                    <Field label="Nombre de la cámara *">
                                        <input value={rtspName} onChange={e => setRtspName(e.target.value)} placeholder="Ej: Entrada Principal" className={inputClass} />
                                    </Field>
                                    <Field label="URL RTSP *" hint={rtspUrlError ?? undefined}>
                                        <input value={rtspUrl} onChange={e => setRtspUrl(e.target.value)} placeholder="rtsp://192.168.1.X:554/stream" className={`${inputClass} ${rtspUrlError ? 'border-red-500/70' : ''}`} />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="Usuario">
                                            <input value={rtspUser} onChange={e => setRtspUser(e.target.value)} placeholder="admin" className={inputClass} />
                                        </Field>
                                        <Field label="Contraseña">
                                            <input type="password" value={rtspPass} onChange={e => setRtspPass(e.target.value)} placeholder="••••••••" className={inputClass} />
                                        </Field>
                                    </div>
                                </div>
                            )}

                            {localSub === 'onvif' && (
                                <div className="flex flex-col gap-3">
                                    <Field label="Nombre de la cámara *">
                                        <input value={onvifName} onChange={e => setOnvifName(e.target.value)} placeholder="Ej: Cámara Patio" className={inputClass} />
                                    </Field>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <Field label="IP de la cámara *">
                                                <input value={onvifIp} onChange={e => setOnvifIp(e.target.value)} placeholder="192.168.1.X" className={inputClass} />
                                            </Field>
                                        </div>
                                        <Field label="Puerto ONVIF">
                                            <input value={onvifPort} onChange={e => setOnvifPort(e.target.value)} placeholder="8000" type="number" className={inputClass} />
                                        </Field>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="Usuario">
                                            <input value={onvifUser} onChange={e => setOnvifUser(e.target.value)} placeholder="admin" className={inputClass} />
                                        </Field>
                                        <Field label="Contraseña">
                                            <input type="password" value={onvifPass} onChange={e => setOnvifPass(e.target.value)} placeholder="••••••••" className={inputClass} />
                                        </Field>
                                    </div>
                                </div>
                            )}

                            {saveError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {saveError}</p>
                            )}

                            <div className="flex justify-end gap-3 pt-1">
                                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors">Cancelar</button>
                                <button
                                    onClick={handleSave}
                                    disabled={!canSave || saving}
                                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
                                        canSave && !saving
                                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                                            : 'bg-white/10 text-gray-600 cursor-not-allowed'
                                    }`}
                                >{saving ? 'Guardando…' : 'Guardar Cámara'}</button>
                            </div>
                        </div>
                    )}

                    {/* ── Integrations tab ──────────────────────────────── */}
                    {tab === 'integrations' && !activeIntegration && (
                        <div className="flex flex-col gap-4">
                            <p className="text-xs text-gray-500">
                                Selecciona un ecosistema para conectar sus cámaras directamente a Scryvex Pro.
                            </p>
                            <div className="grid grid-cols-2 gap-2.5">
                                {INTEGRATIONS.map(i => (
                                    <button
                                        key={i.id}
                                        onClick={() => setActiveIntegration(i.id)}
                                        className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98] ${i.color}`}
                                    >
                                        <div className="flex-shrink-0">{i.logo}</div>
                                        <div className="min-w-0">
                                            <p className="font-semibold text-sm text-white truncate">{i.name}</p>
                                            <p className="text-[11px] text-gray-400 leading-tight truncate">{i.description}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Integration detail form ───────────────────────── */}
                    {tab === 'integrations' && activeIntegration && activeIntData && (
                        <div className="flex flex-col gap-4">
                            <button
                                onClick={() => { setActiveIntegration(null); setSaveError(null); setIntSuccess(null); }}
                                className="flex items-center gap-2 text-xs text-gray-500 hover:text-white transition-colors w-fit"
                            >
                                ← Volver a Integraciones
                            </button>

                            <div className={`flex items-center gap-4 p-4 rounded-xl border ${activeIntData.color}`}>
                                <div className="flex-shrink-0">{activeIntData.logo}</div>
                                <div>
                                    <h3 className="font-bold text-white">{activeIntData.name}</h3>
                                    <p className="text-xs text-gray-400">{activeIntData.description}</p>
                                </div>
                            </div>

                            {intSuccess === activeIntegration ? (
                                <div className="flex flex-col items-center gap-3 py-8 text-center">
                                    <span className="text-4xl">✅</span>
                                    <p className="font-bold text-emerald-400">¡Integración conectada!</p>
                                    <p className="text-xs text-gray-500">Las cámaras se descubrirán automáticamente.</p>
                                    <button onClick={onClose} className="mt-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-lg">Cerrar</button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-col gap-3">
                                        {activeIntData.fields.map(f => (
                                            <Field key={f.key} label={f.label}>
                                                <input
                                                    type={f.type ?? 'text'}
                                                    placeholder={f.placeholder}
                                                    value={integrationFields[activeIntegration]?.[f.key] ?? ''}
                                                    onChange={e => setField(activeIntegration, f.key, e.target.value)}
                                                    className={inputClass}
                                                />
                                            </Field>
                                        ))}
                                    </div>

                                    {saveError && (
                                        <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {saveError}</p>
                                    )}

                                    <div className="flex justify-end gap-3">
                                        <button onClick={() => setActiveIntegration(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors">Cancelar</button>
                                        <button
                                            onClick={() => handleIntegrationConnect(activeIntegration)}
                                            disabled={intSaving}
                                            className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            {intSaving ? 'Conectando…' : `Conectar ${activeIntData.name}`}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const inputClass = 'w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
            {children}
            {hint && <p className="mt-1 text-xs text-red-400">{hint}</p>}
        </div>
    );
}
