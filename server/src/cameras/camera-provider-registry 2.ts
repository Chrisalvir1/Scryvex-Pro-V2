import { CameraMediaProvider, DeviceControlProvider } from '../media/media-source';
import { CameraConfigRepository } from '../media/camera-config-repository';

export interface CameraProvider extends CameraMediaProvider, DeviceControlProvider {
    readonly protocol: string;
}

/**
 * Registry of CameraProviders keyed by protocol string.
 *
 * B3: getProviderForCamera(deviceId) resolves the camera's protocol from
 *     CameraConfigRepository and returns the correct provider — no hardcoded
 *     getProviderForProtocol('RTSP').
 */
export class CameraProviderRegistry {
    private providers = new Map<string, CameraProvider>();

    constructor(private readonly configRepo?: CameraConfigRepository) {}

    register(provider: CameraProvider): void {
        this.providers.set(provider.protocol.toUpperCase(), provider);
    }

    getProviderForProtocol(protocol: string): CameraProvider {
        const p = this.providers.get(protocol.toUpperCase());
        if (!p) {
            throw new Error(`No provider registered for protocol: ${protocol}`);
        }
        return p;
    }

    /**
     * B3: Looks up the camera's protocol via CameraConfigRepository and returns
     * the matching provider.  Falls back to 'RTSP' only if the camera has no
     * explicit protocol recorded.
     */
    async getProviderForCamera(deviceId: string): Promise<CameraProvider> {
        if (!this.configRepo) {
            throw new Error('CameraProviderRegistry: configRepo required for getProviderForCamera');
        }
        const config = await this.configRepo.getCameraConfig(deviceId);
        if (!config) {
            throw new Error(`Camera not found: ${deviceId}`);
        }
        const protocol = (config as any).protocol as string | undefined;
        return this.getProviderForProtocol(protocol?.toUpperCase() ?? 'RTSP');
    }
}
