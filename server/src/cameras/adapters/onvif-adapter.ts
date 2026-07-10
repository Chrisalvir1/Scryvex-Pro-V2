import { CameraConfigRepository } from '../../media/camera-config-repository';
import { CameraMediaProvider, DeviceControlProvider, MediaSourceDescriptor, MediaSourceDiscoveryResult } from '../../media/media-source';
import { CapabilityEvidence } from '../../capabilities/capability-evidence';
import { ConnectionSecretStore } from '../../media/credential-store';

function call<T>(run: (callback: (error: Error | null, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => run((error, value) => error ? reject(error) : resolve(value)));
}

export class OnvifAdapter implements CameraMediaProvider, DeviceControlProvider {
    readonly protocol = 'ONVIF' as const;

    constructor(
        private readonly configRepo: CameraConfigRepository,
        private readonly secretStore: ConnectionSecretStore
    ) {}

    private async connectCam(deviceId: string, signal?: AbortSignal) {
        if (signal?.aborted) throw new Error('Aborted');
        
        const config = await this.configRepo.getCameraConfig(deviceId);
        if (!config) throw new Error('camera_not_found');

        const auth = await this.secretStore.resolveAuthorization(deviceId, signal);
        
        const onvif = await import('onvif');
        
        const candidates = [...new Set([config.onvif_port ?? config.port, 80, 8080, 8899, 8000, 8001].filter(Boolean))];
        let cam: any;
        let lastError: any;

        for (const port of candidates) {
            try {
                cam = await new Promise<any>((resolve, reject) => {
                    let instance: any;
                    instance = new (onvif as any).Cam({
                        hostname: config.ip,
                        port: port,
                        username: auth.username,
                        password: auth.password,
                    }, (error: Error) => error ? reject(error) : resolve(instance));
                });
                break; // Connected successfully
            } catch (err) {
                lastError = err;
            }
        }

        if (!cam) throw lastError;
        return cam;
    }

    async getMediaSources(deviceId: string, signal?: AbortSignal): Promise<MediaSourceDiscoveryResult> {
        try {
            const cam = await this.connectCam(deviceId, signal);
            const profiles = await call<any[]>(cb => cam.getProfiles(cb));
            
            const sources: MediaSourceDescriptor[] = [];
            
            for (const profile of profiles) {
                const token = profile?.$?.token;
                if (!token) continue;

                let streamUri: string | undefined;
                try {
                    const uriResult = await call<any>(cb => cam.getStreamUri({ Protocol: 'RTSP', ProfileToken: token }, cb));
                    streamUri = uriResult?.uri || uriResult?.Uri;
                } catch {
                    // ignore
                }

                if (streamUri) {
                    sources.push({
                        id: token,
                        sourceType: 'onvif',
                        transport: 'tcp',
                        deviceId,
                        profile: profile.Name || token,
                        profileName: profile.Name,
                        sourceLocatorRef: streamUri,
                        credentialRef: deviceId // SessionManager resolves this
                    });
                }
            }

            return {
                available: true,
                sources,
                checkedAt: new Date().toISOString()
            };

        } catch (error) {
            return {
                available: false,
                sources: [],
                reason: (error as Error).message,
                checkedAt: new Date().toISOString()
            };
        }
    }

    async listCapabilities(deviceId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
        const evidence: CapabilityEvidence[] = [];
        try {
            const cam = await this.connectCam(deviceId, signal);

            const [ptzNodes, ptzConfigurations] = await Promise.all([
                call<any>(cb => cam.getNodes(cb)).catch(() => null),
                call<any>(cb => cam.getConfigurations(cb)).catch(() => null)
            ]);

            if ((ptzNodes && ptzNodes.length > 0) || (ptzConfigurations && ptzConfigurations.length > 0)) {
                evidence.push({
                    entity: 'ptz',
                    detected: true,
                    verified: true,
                    readable: true,
                    controllable: true,
                    source: 'onvif-device',
                    confidence: 'verified',
                    operation: 'ptzMove'
                });
            }

            const events = cam.events || cam.capabilities?.Events;
            if (events) {
                evidence.push({
                    entity: 'motion',
                    detected: true,
                    verified: true,
                    readable: true,
                    controllable: false,
                    source: 'onvif-events',
                    confidence: 'verified',
                });
            }

            const relays = await call<any>(cb => cam.getRelayOutputs(cb)).catch(() => null);
            if (relays && Array.isArray(relays) && relays.length > 0) {
                 evidence.push({
                    entity: 'relay',
                    detected: true,
                    verified: true,
                    readable: true,
                    controllable: true,
                    source: 'onvif-device',
                    confidence: 'verified',
                });
            }

        } catch (e) {
            // ignore
        }

        return evidence;
    }
}
