import { CameraConfigRepository } from '../../media/camera-config-repository';
import { CameraMediaProvider, DeviceControlProvider, MediaSourceDescriptor, MediaSourceDiscoveryResult } from '../../media/media-source';
import { CapabilityEvidence } from '../../capabilities/capability-evidence';

/**
 * RTSP adapter: discovers media sources from the camera config.
 * No mock data. Credentials are resolved by the SessionManager via credentialRef.
 * RTSP does NOT generate PTZ, light, siren, talkback or relay capabilities.
 */
export class RtspAdapter implements CameraMediaProvider, DeviceControlProvider {
    readonly protocol = 'RTSP' as const;

    constructor(private readonly configRepo: CameraConfigRepository) {}

    async getMediaSources(deviceId: string, signal?: AbortSignal): Promise<MediaSourceDiscoveryResult> {
        if (signal?.aborted) {
            return { available: false, sources: [], reason: 'cancelled', checkedAt: new Date().toISOString() };
        }

        const config = await this.configRepo.getCameraConfig(deviceId);

        if (!config) {
            return {
                available: false,
                sources: [],
                reason: 'camera_not_found',
                checkedAt: new Date().toISOString(),
            };
        }

        if (!config.rtsp_url) {
            return {
                available: false,
                sources: [],
                reason: 'no_rtsp_url_configured',
                checkedAt: new Date().toISOString(),
            };
        }

        const source: MediaSourceDescriptor = {
            id: 'primary',
            sourceType: 'rtsp',
            transport: 'tcp',
            deviceId,
            // sourceLocatorRef holds the raw URI — credentials are NOT embedded here
            sourceLocatorRef: config.rtsp_url,
            // credentialRef is the deviceId; SessionManager uses it to call ConnectionSecretStore
            credentialRef: deviceId,
        };

        return {
            available: true,
            sources: [source],
            checkedAt: new Date().toISOString(),
        };
    }

    /**
     * RTSP has no controllable entities. Any entit declared here must have
     * verified evidence from the stream itself (motion, audio presence).
     */
    async listCapabilities(deviceId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
        return []; // RTSP exposes no controls — video/audio are confirmed by MediaProbe
    }
}
