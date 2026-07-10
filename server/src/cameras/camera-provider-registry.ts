import { CameraMediaProvider, DeviceControlProvider } from '../media/media-source';

export interface CameraProvider extends CameraMediaProvider, DeviceControlProvider {
    readonly protocol: string;
}

export class CameraProviderRegistry {
    private providers = new Map<string, CameraProvider>();

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

    getProviderForCamera(deviceId: string): CameraProvider {
        throw new Error('Not implemented: getProviderForCamera requires CameraService lookup');
    }
}
