import React, { useState } from 'react';
import type { CreateCameraInput, CameraProtocol } from '../types/camera';
import { apiUrl, publicAssetUrl } from '../lib/ingress-url';



// ── RTSP URL validator ────────────────────────────────────────────────────────
function validateRtspUrl(url: string): string | null {
    if (!url) return null;
    if (!url.startsWith('rtsp://')) return 'La URL debe comenzar con rtsp://';
    try { new URL(url); return null; } catch { return 'Formato de URL inválido'; }
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
    camera: import('../types/camera').Camera;
    onClose: () => void;
    onSave: (id: string, input: Partial<CreateCameraInput>) => Promise<import('../types/camera').Camera>;
}

type LocalSubTab = 'rtsp' | 'onvif';

export function EditCameraModal({ camera, onClose, onSave }: Props) {
    const [localSub, setLocalSub]     = useState<LocalSubTab>(camera.protocol?.toLowerCase() === 'rtsp' ? 'rtsp' : 'onvif');
    const [saving, setSaving]         = useState(false);
    const [saveError, setSaveError]   = useState<string | null>(null);

    // ── RTSP fields ────────────────────────────────────────────────────────────
    const [rtspName, setRtspName]   = useState(camera.name || '');
    const [rtspUrl, setRtspUrl]     = useState(camera.rtsp_url || '');
    const [rtspUser, setRtspUser]   = useState(camera.username || '');
    const [rtspPass, setRtspPass]   = useState('');
    const rtspUrlError              = rtspUrl ? validateRtspUrl(rtspUrl) : null;

    // ── ONVIF fields ───────────────────────────────────────────────────────────
    const [onvifName, setOnvifName] = useState(camera.name || '');
    const [onvifIp, setOnvifIp]     = useState(camera.ip || '');
    const [onvifPort, setOnvifPort] = useState(String(camera.onvif_port || 8000));
    const [onvifUser, setOnvifUser] = useState(camera.username || 'admin');
    const [onvifPass, setOnvifPass] = useState('');
    const [portTestLoading, setPortTestLoading] = useState(false);
    const [portTestResult, setPortTestResult] = useState<{ detectedPort?: number; message: string; results: Array<{ port: number; tcpReachable: boolean; onvif: boolean; message?: string }> } | null>(null);

    const handleSave = async () => {
        setSaveError(null);
        const input: Partial<CreateCameraInput> = localSub === 'rtsp'
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
            await onSave(camera.id, input);
            onClose();
        } catch (err: unknown) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const testOnvifPorts = async () => {
        setPortTestLoading(true); setPortTestResult(null); setSaveError(null);
        try {
            const response = await fetch(apiUrl('api/cameras/test-onvif-port'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: onvifIp, onvif_port: Number(onvifPort), username: onvifUser, password: onvifPass }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'No se pudo probar el puerto');
            setPortTestResult(data);
            if (data.detectedPort) setOnvifPort(String(data.detectedPort));
        } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
        finally { setPortTestLoading(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4">
            <div className="bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="p-4 sm:p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <span>✏️</span> Editar Cámara
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-5 overflow-y-auto flex-1">
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
                            <button type="button" onClick={testOnvifPorts} disabled={!onvifIp.trim() || portTestLoading} className="self-start px-4 py-2 text-xs font-bold text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/20 disabled:opacity-40">
                                {portTestLoading ? 'Probando puertos…' : '🔎 Probar ONVIF y detectar puerto'}
                            </button>
                            {saveError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {saveError}</p>
                            )}

                            <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                                <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-gray-400 hover:text-white transition-colors">Cancelar</button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-white text-sm font-bold rounded-lg shadow-lg shadow-blue-500/20 disabled:shadow-none transition-all flex items-center gap-2"
                                >
                                    {saving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                    Guardar Cambios
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
