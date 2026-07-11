import { ScryptedDevice } from '@scrypted/types';

/**
 * El PluginRepository es el ÚNICO componente autorizado en toda
 * la arquitectura para tocar o referenciar el Runtime de Scrypted.
 */
export class PluginRepository {
    constructor(private readonly runtime: any) {}

    getRawPlugins(): string[] {
        return Object.keys(this.runtime.plugins || {});
    }

    getRawDevices(): ScryptedDevice[] {
        const devices: ScryptedDevice[] = [];
        const deviceKeys = Object.keys(this.runtime.devices || {});
        for (const id of deviceKeys) {
            const pair = this.runtime.devices[id];
            if (pair && pair.proxy) {
                devices.push(pair.proxy);
            }
        }
        return devices;
    }

    getRawDevice(id: string): ScryptedDevice | undefined {
        const pair = this.runtime.devices[id];
        return pair ? pair.proxy : undefined;
    }

    async getRawSettings(proxy: ScryptedDevice): Promise<any[]> {
        const anyProxy = proxy as any;
        if (typeof anyProxy.getSettings === 'function') {
            try {
                return await anyProxy.getSettings();
            } catch (e) {
                // Return empty if settings crash
                return [];
            }
        }
        return [];
    }

    async getRawMediaOptions(proxy: ScryptedDevice): Promise<any[]> {
        const anyProxy = proxy as any;
        if (typeof anyProxy.getVideoStreamOptions === 'function') {
            try {
                return await anyProxy.getVideoStreamOptions();
            } catch (e) {
                return [];
            }
        }
        return [];
    }
}
