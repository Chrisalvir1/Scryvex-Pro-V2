import { CameraMediaProvider, MediaSourceDescriptor, DeviceControlProvider, MediaSourceDiscoveryResult } from '../../media/media-source';
import { CapabilityEvidence } from '../../capabilities/capability-evidence';
import { ResolvedMediaInput, MediaInputResolver } from '../../media/media-resolvers';
import { ConnectionSecretStore } from '../../media/credential-store';

// This is a dummy interface representing the legacy Scrypted plugin model
interface LegacyPluginHost {
    getDevice(id: string): any;
}

export class LegacyPluginMediaProviderAdapter implements CameraMediaProvider, DeviceControlProvider {
    readonly protocol = 'PLUGIN' as const;

    constructor(private host: LegacyPluginHost, private pluginId: string) {}

    async getMediaSources(deviceId: string, signal?: AbortSignal): Promise<MediaSourceDiscoveryResult> {
        if (signal?.aborted) return { available: false, sources: [], reason: 'cancelled', checkedAt: new Date().toISOString() };
        
        const device = this.host.getDevice(deviceId);
        const sources: MediaSourceDescriptor[] = [];
        
        if (device && device.getVideoStream) {
            sources.push({
                id: 'video',
                sourceType: 'plugin_buffer', // The resolver will refine this based on MediaObject
                transport: 'buffer',
                deviceId,
                pluginId: this.pluginId,
                credentialRef: deviceId, 
            });
        }
        
        return {
            available: sources.length > 0,
            sources,
            checkedAt: new Date().toISOString()
        };
    }

    async listCapabilities(deviceId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
        const device = this.host.getDevice(deviceId);
        if (!device) return [];

        const evidence: CapabilityEvidence[] = [];

        // Scrypted real interfaces
        if (device.interfaces?.includes('OnOff') && device.type === 'Light') {
            evidence.push({
                entity: 'light',
                detected: true,
                verified: true,
                readable: true,
                controllable: true,
                source: 'plugin',
                confidence: 'verified',
                operation: 'turnOn' // The action payload mapping will handle calling device.turnOn()
            });
        }

        if (device.interfaces?.includes('BinarySensor') || device.interfaces?.includes('MotionSensor')) {
             evidence.push({
                entity: 'motion',
                detected: true,
                verified: true,
                readable: true,
                controllable: false,
                source: 'plugin',
                confidence: 'verified'
            });
        }

        return evidence;
    }
}

export class PluginMediaObjectResolver implements MediaInputResolver {
    constructor(private host: LegacyPluginHost) {}

    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'plugin_buffer' || descriptor.sourceType === 'plugin_pipe';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        if (signal?.aborted) throw new Error('Aborted');
        
        const device = this.host.getDevice(descriptor.deviceId);
        if (!device || !device.getVideoStream) {
            throw new Error(`Device ${descriptor.deviceId} does not support getVideoStream`);
        }
        
        // This simulates requesting the actual media object from the legacy plugin
        const media = await device.getVideoStream();
        // media might be { mimeType: 'url', data: 'http...' } or { mimeType: 'buffer', data: Buffer }
        
        if (media.mimeType && media.mimeType.includes('rtsp')) {
            return {
                kind: 'rtsp',
                ffmpegInputArguments: ['-i', media.data],
                probeStrategy: 'ffprobe',
                redactedDescription: `PluginMedia[${descriptor.pluginId}] RTSP`
            };
        }

        if (Buffer.isBuffer(media.data)) {
            return {
                kind: 'buffer',
                ffmpegInputArguments: ['-i', 'pipe:0'], 
                probeStrategy: 'buffer_magic',
                redactedDescription: `PluginMedia[${descriptor.pluginId}] Buffer`,
                mimeType: media.mimeType,
                inputBuffer: media.data
            };
        }
        
        if (media.data && typeof media.data.pipe === 'function') {
            return {
                kind: 'pipe',
                ffmpegInputArguments: ['-i', 'pipe:0'], 
                probeStrategy: 'buffer_magic',
                redactedDescription: `PluginMedia[${descriptor.pluginId}] Pipe`,
                mimeType: media.mimeType,
                inputStream: media.data,
                cleanup: async () => {
                    if (typeof media.data.destroy === 'function') {
                        media.data.destroy();
                    }
                }
            };
        }
        
        throw new Error(`Unsupported MediaObject mimeType/data format from plugin ${descriptor.pluginId}`);
    }
}
