import { ScryptedDevice } from '@scrypted/types';
import { DeviceModel, UiSetting } from './DeviceModel';
import { PluginRepository } from './PluginRepository';

export class DeviceModelFactory {
    private revisionMap = new Map<string, number>();

    constructor(private readonly pluginRepo: PluginRepository) {}

    async buildFromRaw(proxy: ScryptedDevice): Promise<DeviceModel> {
        const currentRev = (this.revisionMap.get(proxy.id) || 0) + 1;
        this.revisionMap.set(proxy.id, currentRev);

        const rawSettings = await this.pluginRepo.getRawSettings(proxy);
        const rawMedia = await this.pluginRepo.getRawMediaOptions(proxy);
        
        const interfaces = proxy.interfaces || [];
        const capabilities = this.normalizeCapabilities(interfaces);

        return {
            id: proxy.id,
            revision: currentRev,
            generatedAt: new Date(),
            plugin: proxy.pluginId || 'unknown',
            name: proxy.name || proxy.info?.model || 'Unknown Device',
            manufacturer: proxy.info?.manufacturer || 'Unknown',
            model: proxy.info?.model || 'Unknown',
            interfaces,
            capabilities,
            media: {
                options: rawMedia
            },
            settings: this.normalizeSettings(proxy.id, proxy.pluginId, rawSettings),
            entities: [], // Computed later
            diagnostics: { status: 'healthy' } // Placeholder
        };
    }

    private normalizeCapabilities(interfaces: string[]): string[] {
        const capabilities = new Set<string>();
        if (interfaces.includes('Camera')) capabilities.add('Camera');
        if (interfaces.includes('VideoCamera')) capabilities.add('VideoCamera');
        if (interfaces.includes('MotionSensor')) capabilities.add('MotionSensor');
        if (interfaces.includes('ObjectDetector')) capabilities.add('ObjectDetector');
        if (interfaces.includes('TwoWayAudio')) capabilities.add('Intercom');
        if (interfaces.includes('AudioSensor')) capabilities.add('AudioSensor');
        if (interfaces.includes('PanTiltZoom')) capabilities.add('PTZ');
        if (interfaces.includes('OnOff')) capabilities.add('OnOff');
        return Array.from(capabilities);
    }

    private normalizeSettings(deviceId: string, pluginId: string = 'unknown', rawSettings: any[]): UiSetting[] {
        if (!rawSettings) return [];
        return rawSettings.map(raw => {
            const isSecret = raw.type === 'password' || raw.type === 'secret';
            return {
                pluginId,
                deviceId,
                key: raw.key,
                title: raw.title || raw.key,
                description: raw.description,
                type: this.mapType(raw.type),
                value: isSecret ? null : raw.value,
                secret: isSecret,
                configured: isSecret ? (raw.value !== null && raw.value !== undefined && raw.value !== '') : undefined,
                choices: raw.choices,
                group: raw.group || 'General',
                subgroup: raw.subgroup,
                advanced: !!raw.advanced,
                hidden: !!raw.hidden,
                readOnly: !!raw.readonly,
                restartRequired: !!raw.restartRequired,
                source: 'scrypted',
                classification: 'original'
            };
        });
    }

    private mapType(type: string): UiSetting['type'] {
        switch (type) {
            case 'boolean':
            case 'number':
            case 'string':
            case 'password':
            case 'button':
                return type;
            default:
                if (type?.includes('device')) return 'device';
                if (type?.includes('interface')) return 'interface';
                if (type?.includes('select')) return 'select';
                return 'string';
        }
    }
}
