import React, { useState } from 'react';
import type { CreateCameraInput, CameraProtocol } from '../types/camera';

// ── Integration card data ─────────────────────────────────────────────────────
const INTEGRATIONS = [
    {
        id: 'ring',
        name: 'Ring',
        description: 'Video doorbell & cameras',
        available: false,
        logo: (
            <svg viewBox="0 0 80 80" fill="none" className="w-10 h-10">
                <circle cx="40" cy="40" r="38" fill="#1C9BE6" stroke="#1C9BE6" strokeWidth="2"/>
                <path d="M40 15C26.2 15 15 26.2 15 40s11.2 25 25 25 25-11.2 25-25S53.8 15 40 15zm0 40c-8.3 0-15-6.7-15-15s6.7-15 15-15 15 6.7 15 15-6.7 15-15 15z" fill="white"/>
                <circle cx="40" cy="40" r="7" fill="white"/>
            </svg>
        ),
    },
    {
        id: 'nest',
        name: 'Google Nest',
        description: 'SDM API via OAuth 2.0',
        available: true,
        logo: (
            <svg viewBox="0 0 80 80" fill="none" className="w-10 h-10">
                <circle cx="40" cy="40" r="38" fill="#4285F4" stroke="#4285F4" strokeWidth="2"/>
                <text x="40" y="52" textAnchor="middle" fontSize="28" fontWeight="bold" fill="white">G</text>
            </svg>
        ),
    },
    {
        id: 'arlo',
        name: 'Arlo',
        description: 'Cloud cameras',
        available: false,
        logo: (
            <svg viewBox="0 0 80 80" fill="none" className="w-10 h-10">
                <circle cx="40" cy="40" r="38" fill="#18191A" stroke="#444" strokeWidth="2"/>
                <path d="M22 52L40 20l18 32H22z" fill="#00C9A7"/>
            </svg>
        ),
    },
    {
        id: 'tuya',
        name: 'Tuya',
        description: 'Smart home ecosystem',
        available: false,
        logo: (
            <svg viewBox="0 0 80 80" fill="none" className="w-10 h-10">
                <circle cx="40" cy="40" r="38" fill="#FF6600" stroke="#FF6600" strokeWidth="2"/>
                <text x="40" y="52" textAnchor="middle" fontSize="26" fontWeight="bold" fill="white">T</text>
            </svg>
        ),
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
    const [tab, setTab]           = useState<Tab>('local');
    const [localSub, setLocalSub] = useState<LocalSubTab>('rtsp');
    const [saving, setSaving]     = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // ── RTSP fields ───────────────────────────────────────────────────────────
    const [rtspName, setRtspName]   = useState('');
    const [rtspUrl, setRtspUrl]     = useState('');
    const [rtspUser, setRtspUser]   = useState('');
    const [rtspPass, setRtspPass]   = useState('');
    const rtspUrlError              = rtspUrl ? validateRtspUrl(rtspUrl) : null;

    // ── ONVIF fields ──────────────────────────────────────────────────────────
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
                ip:       new URL(rtspUrl.replace('rtsp://', 'http://')).hostname,
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

    const rtspValid = rtspName.trim() && rtspUrl.trim() && !rtspUrlError;
    const onvifValid = onvifName.trim() && onvifIp.trim();
    const canSave = localSub === 'rtsp' ? rtspValid : onvifValid;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <div className="bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex justify-between items-center px-6 py-5 border-b border-white/10 bg-white/[0.02]">
                    <h2 className="text-xl font-bold tracking-tight">Agregar Cámara</h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-all"
                    >
                        ✕
                    </button>
                </div>

                {/* Main tabs */}
                <div className="flex border-b border-white/10 bg-black/20">
                    <button
                        onClick={() => setTab('local')}
                        className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                            tab === 'local'
                                ? 'text-blue-400 border-b-2 border-blue-500 bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                        }`}
                    >
                        📡 Red Local
                    </button>
                    <button
                        onClick={() => setTab('integrations')}
                        className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
                            tab === 'integrations'
                                ? 'text-purple-400 border-b-2 border-purple-500 bg-white/5'
                                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                        }`}
                    >
                        🔌 Integraciones
                    </button>
                </div>

                <div className="p-6">

                    {/* ── Local tab ───────────────────────────────────────── */}
                    {tab === 'local' && (
                        <div className="flex flex-col gap-5">
                            {/* Sub-tabs: RTSP vs ONVIF */}
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
                                    >
                                        {s.toUpperCase()}
                                    </button>
                                ))}
                            </div>

                            {/* ── RTSP form ─────────────────────────────── */}
                            {localSub === 'rtsp' && (
                                <div className="flex flex-col gap-4 animate-in fade-in duration-150">
                                    <Field label="Nombre de la cámara *">
                                        <input
                                            value={rtspName}
                                            onChange={e => setRtspName(e.target.value)}
                                            placeholder="Ej: Entrada Principal"
                                            className={inputClass}
                                        />
                                    </Field>
                                    <Field label="URL RTSP *" hint={rtspUrlError ?? undefined}>
                                        <input
                                            value={rtspUrl}
                                            onChange={e => setRtspUrl(e.target.value)}
                                            placeholder="rtsp://192.168.1.X:554/stream"
                                            className={`${inputClass} ${rtspUrlError ? 'border-red-500/70' : ''}`}
                                        />
                                    </Field>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="Usuario">
                                            <input
                                                value={rtspUser}
                                                onChange={e => setRtspUser(e.target.value)}
                                                placeholder="admin"
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label="Contraseña">
                                            <input
                                                type="password"
                                                value={rtspPass}
                                                onChange={e => setRtspPass(e.target.value)}
                                                placeholder="••••••••"
                                                className={inputClass}
                                            />
                                        </Field>
                                    </div>
                                </div>
                            )}

                            {/* ── ONVIF form ────────────────────────────── */}
                            {localSub === 'onvif' && (
                                <div className="flex flex-col gap-4 animate-in fade-in duration-150">
                                    <Field label="Nombre de la cámara *">
                                        <input
                                            value={onvifName}
                                            onChange={e => setOnvifName(e.target.value)}
                                            placeholder="Ej: Cámara Patio"
                                            className={inputClass}
                                        />
                                    </Field>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <Field label="IP de la cámara *">
                                                <input
                                                    value={onvifIp}
                                                    onChange={e => setOnvifIp(e.target.value)}
                                                    placeholder="192.168.1.X"
                                                    className={inputClass}
                                                />
                                            </Field>
                                        </div>
                                        <Field label="Puerto ONVIF">
                                            <input
                                                value={onvifPort}
                                                onChange={e => setOnvifPort(e.target.value)}
                                                placeholder="8000"
                                                type="number"
                                                className={inputClass}
                                            />
                                        </Field>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="Usuario">
                                            <input
                                                value={onvifUser}
                                                onChange={e => setOnvifUser(e.target.value)}
                                                placeholder="admin"
                                                className={inputClass}
                                            />
                                        </Field>
                                        <Field label="Contraseña">
                                            <input
                                                type="password"
                                                value={onvifPass}
                                                onChange={e => setOnvifPass(e.target.value)}
                                                placeholder="••••••••"
                                                className={inputClass}
                                            />
                                        </Field>
                                    </div>
                                </div>
                            )}

                            {saveError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                                    ⚠️ {saveError}
                                </p>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={!canSave || saving}
                                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${
                                        canSave && !saving
                                            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                                            : 'bg-white/10 text-gray-600 cursor-not-allowed'
                                    }`}
                                >
                                    {saving ? 'Guardando…' : 'Guardar Cámara'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Integrations tab ────────────────────────────────── */}
                    {tab === 'integrations' && (
                        <div className="flex flex-col gap-5">
                            <p className="text-sm text-gray-400">
                                Conecta ecosistemas cloud. Las cámaras descubiertas se desacoplan
                                como entidades independientes en PostgreSQL (Multi-Instancia).
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                {INTEGRATIONS.map(i => (
                                    <button
                                        key={i.id}
                                        disabled={!i.available}
                                        className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                                            i.available
                                                ? 'border-purple-500/40 bg-purple-500/10 hover:bg-purple-500/20 cursor-pointer'
                                                : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                                        }`}
                                    >
                                        {i.logo}
                                        <div>
                                            <p className="font-semibold text-sm text-white">{i.name}</p>
                                            <p className="text-xs text-gray-400">{i.description}</p>
                                            {!i.available && (
                                                <span className="text-[10px] text-yellow-500 font-bold">PRÓXIMAMENTE</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {/* Google Nest SDM — the only live integration */}
                            <div className="bg-blue-900/20 border border-blue-500/30 p-5 rounded-xl">
                                <h3 className="font-bold text-blue-300 mb-1 flex items-center gap-2">
                                    <span>Google Nest SDM</span>
                                    <span className="text-[10px] bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full font-bold">ACTIVO</span>
                                </h3>
                                <p className="text-xs text-blue-200/70 mb-4">
                                    Ingresa tus credenciales de la Device Access Console. Scryvex Pro actuará como proxy OAuth 2.0 local y negociará WebRTC puro.
                                </p>
                                <input type="text" placeholder="Project ID" className={`${inputClass} mb-3`} />
                                <input type="text" placeholder="GCP Client ID" className={`${inputClass} mb-3`} />
                                <input type="password" placeholder="GCP Client Secret" className={`${inputClass} mb-4`} />
                                <button className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors">
                                    Iniciar Autorización OAuth 2.0
                                </button>
                            </div>
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
