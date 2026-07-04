import { useEffect, useState } from 'react';
import type { ScryptedDevice, Setting, Settings } from '@scrypted/types';

export function NativeDeviceSettings({ device }: { device: ScryptedDevice }) {
    const [settings, setSettings] = useState<Setting[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                if (device.interfaces.includes('Settings')) {
                    const s = await (device as any as Settings).getSettings();
                    setSettings(s || []);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [device]);

    const handleSave = async (setting: Setting, value: any) => {
        if (!setting.key) return;
        try {
            await (device as any as Settings).putSetting(setting.key, value);
            // Reload
            const s = await (device as any as Settings).getSettings();
            setSettings(s || []);
        } catch (e) {
            console.error(e);
            alert('Failed to save setting');
        }
    };

    if (loading) return <div style={{ padding: '24px' }}>Loading settings...</div>;
    if (settings.length === 0) return <div style={{ padding: '24px' }}>No settings available for this device.</div>;

    return (
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {settings.map(s => (
                <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontWeight: 'bold' }}>{s.title}</label>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{s.description}</p>
                    
                    {s.type === 'button' ? (
                        <button
                            className="glass-button"
                            onClick={() => handleSave(s, true)}
                            style={{ alignSelf: 'flex-start' }}
                        >
                            {s.title || 'Run'}
                        </button>
                    ) : s.type === 'boolean' ? (
                        <label style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="checkbox"
                                checked={s.value === true || s.value === 'true'}
                                disabled={s.readonly}
                                onChange={(e) => handleSave(s, e.target.checked)}
                            />
                            <span>{s.value === true || s.value === 'true' ? 'Enabled' : 'Disabled'}</span>
                        </label>
                    ) : s.type === 'textarea' || s.readonly ? (
                        <textarea
                            className="glass-input"
                            value={s.value?.toString() || ''}
                            readOnly={s.readonly}
                            onBlur={(e) => !s.readonly && handleSave(s, e.target.value)}
                            style={{ minHeight: '90px', padding: '8px', background: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--glass-border)' }}
                        />
                    ) : s.choices ? (
                        <select 
                            className="glass-input" 
                            defaultValue={s.value?.toString() || ''}
                            disabled={s.readonly}
                            onChange={(e) => handleSave(s, e.target.value)}
                            style={{ padding: '8px', background: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--glass-border)' }}
                        >
                            <option value="">-- Select --</option>
                            {s.choices.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    ) : (
                        <input 
                            type={s.type === 'password' ? 'password' : 'text'}
                            className="glass-input" 
                            defaultValue={s.value?.toString() || ''}
                            onBlur={(e) => handleSave(s, e.target.value)}
                            style={{ padding: '8px', background: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--glass-border)' }}
                        />
                    )}
                </div>
            ))}
        </div>
    );
}
