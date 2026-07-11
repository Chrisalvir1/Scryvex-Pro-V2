import { ScryptedDevice } from '@scrypted/types';
import type { RawDeviceSnapshot, DeviceReadError, RawSettingSnapshot, RawMediaOptionSnapshot } from '@scryvex/contracts';

/**
 * El PluginRepository es el ÚNICO componente autorizado en toda
 * la arquitectura para tocar o referenciar el Runtime de Scrypted.
 */
export class PluginRepository {
    constructor(private readonly runtime: any) {}

    getRawPlugins(): string[] {
        return Object.keys(this.runtime.plugins || {});
    }

    getDeviceIds(): string[] {
        return Object.keys(this.runtime.devices || {});
    }

    async getRawSnapshot(id: string): Promise<RawDeviceSnapshot | undefined> {
        const pair = this.runtime.devices?.[id];
        if (!pair || !pair.proxy) return undefined;

        const proxy = pair.proxy as any;
        const readErrors: DeviceReadError[] = [];
        
        const withTimeout = async <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
            let timeoutHandle: any;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(errorMsg)), ms);
            });
            return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
        };

        let settings: RawSettingSnapshot[] = [];
        if (typeof proxy.getSettings === 'function') {
            try {
                const raw = await withTimeout(proxy.getSettings(), 5000, 'SETTINGS_READ_TIMEOUT');
                if (Array.isArray(raw)) {
                    settings = raw.map((r: any) => ({
                        key: r.key,
                        title: r.title,
                        description: r.description,
                        type: r.type || 'unknown',
                        value: r.value,
                        choices: r.choices,
                        group: r.group,
                        subgroup: r.subgroup,
                        advanced: r.advanced,
                        hidden: r.hidden,
                        readonly: r.readonly,
                        restartRequired: r.restartRequired,
                        placeholder: r.placeholder,
                        range: r.range,
                        multiple: r.multiple,
                        combobox: r.combobox,
                        deviceFilter: r.deviceFilter
                    }));
                }
            } catch (e: any) {
                readErrors.push({
                    source: 'settings',
                    code: e.code || 'READ_ERROR',
                    message: e.message || String(e),
                    occurredAt: new Date().toISOString()
                });
            }
        }

        let mediaOptions: RawMediaOptionSnapshot[] = [];
        if (typeof proxy.getVideoStreamOptions === 'function') {
            try {
                const raw = await withTimeout(proxy.getVideoStreamOptions(), 5000, 'MEDIA_READ_TIMEOUT');
                if (Array.isArray(raw)) {
                    mediaOptions = raw.map((r: any) => ({
                        id: r.id,
                        name: r.name,
                        video: r.video ? { codec: r.video.codec } : undefined,
                        audio: r.audio ? { codec: r.audio.codec } : undefined,
                        container: r.container,
                        width: r.width,
                        height: r.height,
                        fps: r.fps,
                        bitrate: r.bitrate,
                        source: r.source,
                        purpose: r.purpose
                    }));
                }
            } catch (e: any) {
                readErrors.push({
                    source: 'media',
                    code: e.code || 'READ_ERROR',
                    message: e.message || String(e),
                    occurredAt: new Date().toISOString()
                });
            }
        }

        // Sanitización primaria de secretos
        const sanitizedSettings = this.redactSecrets(settings);

        return {
            id: proxy.id,
            pluginId: proxy.pluginId || 'unknown',
            name: proxy.name || proxy.info?.model || 'Unknown',
            type: proxy.type,
            manufacturer: proxy.info?.manufacturer,
            model: proxy.info?.model,
            interfaces: proxy.interfaces || [],
            settings: sanitizedSettings,
            mediaOptions,
            readErrors
        };
    }

    private redactSecrets(settings: RawSettingSnapshot[]): RawSettingSnapshot[] {
        return settings.map(s => {
            const lowerKey = (s.key || '').toLowerCase();
            const lowerType = (s.type || '').toLowerCase();
            const isSecret = 
                lowerType === 'password' || 
                lowerType === 'secret' ||
                lowerKey.includes('password') ||
                lowerKey.includes('token') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('apikey') ||
                lowerKey.includes('authorization') ||
                lowerKey.includes('cookie') ||
                lowerKey.includes('privatekey') ||
                lowerKey.includes('pin') ||
                lowerKey.includes('pairingcode');
                
            if (isSecret) {
                return { ...s, value: null }; // Value redacted
            }

            // Sanitizar URLs de media o settings que puedan tener credenciales userinfo
            if (typeof s.value === 'string') {
                const sanitizedVal = this.sanitizeUrl(s.value);
                if (sanitizedVal !== s.value) {
                    return { ...s, value: sanitizedVal };
                }
            }

            return s;
        });
    }

    private sanitizeUrl(urlStr: string): string {
        // Simple regex to replace user:pass@ in URLs
        return urlStr.replace(/:\/\/[^/]+@/g, '://***:***@');
    }
}
