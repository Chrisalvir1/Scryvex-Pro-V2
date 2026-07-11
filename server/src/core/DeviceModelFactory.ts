import * as crypto from 'crypto';
import type { 
    RawDeviceSnapshot, 
    DeviceModelView, 
    NormalizedSetting,
    RawSettingSnapshot,
    RawMediaOptionSnapshot,
    NormalizedMediaOption
} from '@scryvex/contracts';

export class DeviceModelFactory {
    public buildFromSnapshot(snapshot: RawDeviceSnapshot): DeviceModelView {
        // Calculate stable hash
        const contentHash = this.calculateHash(snapshot);
        
        const interfaces = [...snapshot.interfaces];
        const capabilities = this.normalizeCapabilities(interfaces);

        return {
            id: snapshot.id,
            revision: contentHash,
            generatedAt: new Date().toISOString(),
            plugin: snapshot.pluginId || 'unknown',
            name: snapshot.name || snapshot.model || 'Unknown Device',
            manufacturer: snapshot.manufacturer || 'Unknown',
            model: snapshot.model || 'Unknown',
            interfaces,
            capabilities,
            media: {
                options: this.normalizeMedia(snapshot.id, snapshot.mediaOptions)
            },
            settings: this.normalizeSettings(snapshot.id, snapshot.pluginId, snapshot.settings),
            diagnostics: { status: 'not_evaluated' }
        };
    }

    private calculateHash(snapshot: RawDeviceSnapshot): string {
        const stableContent = {
            id: snapshot.id,
            pluginId: snapshot.pluginId,
            interfaces: [...snapshot.interfaces].sort(),
            settings: snapshot.settings.map((s: RawSettingSnapshot) => ({
                key: s.key,
                type: s.type,
                value: s.value,
                choices: s.choices
            })),
            mediaOptions: snapshot.mediaOptions.map((m: RawMediaOptionSnapshot) => ({
                id: m.id,
                name: m.name,
                source: m.source
            })),
            readErrors: snapshot.readErrors.map((e: import('@scryvex/contracts').DeviceReadError) => ({
                code: e.code,
                source: e.source
            }))
        };
        
        const json = JSON.stringify(stableContent, Object.keys(stableContent).sort());
        return crypto.createHash('sha256').update(json).digest('hex').substring(0, 12);
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

    private normalizeMedia(deviceId: string, rawMedia: readonly RawMediaOptionSnapshot[]): NormalizedMediaOption[] {
        return rawMedia.map(m => ({
            id: m.id,
            name: m.name,
            container: m.container,
            videoCodec: m.video?.codec,
            audioCodec: m.audio?.codec,
            width: m.width,
            height: m.height,
            fps: m.fps,
            bitrate: m.bitrate,
            source: m.source,
            purpose: m.purpose
        }));
    }

    private normalizeSettings(deviceId: string, pluginId: string = 'unknown', rawSettings: readonly RawSettingSnapshot[]): NormalizedSetting[] {
        if (!rawSettings) return [];
        return rawSettings.map(raw => {
            const mappedType = this.mapType(raw.type);
            const isSecret = mappedType === 'password'; // El repo ya limpió el value, pero lo re-afirmamos semánticamente.
            
            return {
                pluginId,
                deviceId,
                key: raw.key,
                title: raw.title || raw.key,
                description: raw.description,
                type: mappedType,
                originalType: mappedType === 'unknown' ? raw.type : undefined,
                value: isSecret ? null : (raw.value as string | number | boolean | null),
                secret: isSecret,
                configured: isSecret ? (raw.value !== null && raw.value !== undefined && raw.value !== '') : undefined,
                choices: raw.choices ? [...raw.choices] : undefined,
                group: raw.group || 'General',
                subgroup: raw.subgroup,
                advanced: !!raw.advanced,
                hidden: !!raw.hidden,
                readOnly: !!raw.readonly,
                restartRequired: !!raw.restartRequired,
                placeholder: raw.placeholder,
                range: raw.range ? [...raw.range] as [number, number] : undefined,
                multiple: raw.multiple,
                combobox: raw.combobox,
                deviceFilter: raw.deviceFilter,
                source: 'scrypted',
                classification: 'original'
            };
        });
    }

    private mapType(type: string): NormalizedSetting['type'] {
        const lowerType = String(type || '').toLowerCase();
        switch (lowerType) {
            case 'boolean':
            case 'number':
            case 'string':
            case 'password':
            case 'button':
                return lowerType;
            default:
                if (lowerType.includes('device')) return 'device';
                if (lowerType.includes('interface')) return 'interface';
                if (lowerType.includes('select')) return 'select';
                return 'unknown';
        }
    }
}
