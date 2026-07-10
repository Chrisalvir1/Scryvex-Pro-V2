import { CameraService } from '../api/camera-service';

export interface CameraConfig {
    id: string;
    ip: string;
    port: number;
    onvif_port?: number;
    rtsp_url?: string;
    config: Record<string, unknown>;
}

/**
 * Provides camera configuration (no secrets) for media adapters.
 * Adapters receive config here; credential resolution is handled by ConnectionSecretStore.
 */
export class CameraConfigRepository {
    constructor(private readonly cameraService: CameraService) {}

    async getCameraConfig(deviceId: string): Promise<CameraConfig | undefined> {
        const camera = await this.cameraService.findById(deviceId);
        if (!camera) return undefined;
        return {
            id: camera.id,
            ip: camera.ip,
            port: camera.port,
            onvif_port: camera.onvif_port,
            rtsp_url: camera.rtsp_url,
            config: camera.config,
        };
    }
}
