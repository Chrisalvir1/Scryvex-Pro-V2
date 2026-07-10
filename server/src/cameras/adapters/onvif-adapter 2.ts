import type { CameraAdapter, CameraConnectionInput, CameraDiscoveryResult, CameraCapabilities, ConnectionTestResult, StreamProfile } from '../camera-adapter';
import { emptyCapabilities } from '../camera-adapter';

export class OnvifAdapter implements CameraAdapter {
    readonly protocol = 'ONVIF' as const;
    async discover(input: CameraConnectionInput): Promise<CameraDiscoveryResult> {
        const capabilities = emptyCapabilities('onvif');
        try {
            // The optional dependency is loaded here so RTSP-only installations do not require ONVIF.
            const onvif = await import('onvif');
            const cam = await new Promise<any>((resolve, reject) => { let instance: any; instance = new (onvif as any).Cam({ hostname: input.ip, port: input.onvif_port ?? input.port, username: input.username, password: input.password }, (error: Error) => error ? reject(error) : resolve(instance)); });
            const profiles = await new Promise<any[]>((resolve, reject) => cam.getProfiles((error: Error, value: any[]) => error ? reject(error) : resolve(value)));
            const streamProfiles: StreamProfile[] = [];
            for (const [index, profile] of profiles.entries()) { const token = profile?.$?.token; let streamUri: string | undefined; let snapshotUri: string | undefined; try { streamUri = (await new Promise<any>((resolve, reject) => cam.getStreamUri({ protocol: 'RTSP', profileToken: token }, (e: Error, v: any) => e ? reject(e) : resolve(v))))?.uri; } catch {} try { snapshotUri = (await new Promise<any>((resolve, reject) => cam.getSnapshotUri({ profileToken: token }, (e: Error, v: any) => e ? reject(e) : resolve(v))))?.uri; } catch {} const encoder = profile?.videoEncoderConfiguration; streamProfiles.push({ id: token ?? `onvif-${index}`, name: profile?.name, codec: encoder?.encoding, width: encoder?.resolution?.width, height: encoder?.resolution?.height, fps: encoder?.rateControl?.frameRateLimit, bitrate: encoder?.rateControl?.bitrateLimit, streamUri, snapshotUri }); }
            const info = await new Promise<any>((resolve, reject) => cam.getDeviceInformation((e: Error, v: any) => e ? reject(e) : resolve(v))).catch(() => ({}));
            capabilities.discoveryStatus = 'online'; capabilities.lastCheckedAt = new Date().toISOString(); capabilities.manufacturer = info.Manufacturer; capabilities.model = info.Model; capabilities.firmware = info.FirmwareVersion; capabilities.serialNumber = info.SerialNumber; capabilities.video.profiles = streamProfiles; capabilities.video.supportsH264 = streamProfiles.some(p => p.codec?.toUpperCase() === 'H264'); capabilities.video.supportsH265 = streamProfiles.some(p => ['H265', 'HEVC'].includes(p.codec?.toUpperCase() ?? '')); capabilities.video.selectedProfileId = streamProfiles[0]?.id; capabilities.preview.snapshot = streamProfiles.some(p => !!p.snapshotUri); capabilities.preview.rtsp = streamProfiles.some(p => !!p.streamUri); return { capabilities, streamProfiles };
        } catch (error) { capabilities.discoveryStatus = 'error'; capabilities.lastCheckedAt = new Date().toISOString(); throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { capabilities }); }
    }
    async getCapabilities(input: CameraConnectionInput) { return (await this.discover(input)).capabilities; }
    async testConnection(input: CameraConnectionInput): Promise<ConnectionTestResult> { try { await this.discover(input); return { success: true, status: 'online' }; } catch (error) { return { success: false, status: 'error', message: error instanceof Error ? error.message : String(error) }; } }
}
