import { CameraConfigRepository } from '../../media/camera-config-repository';
import { CameraMediaProvider, DeviceControlProvider, MediaSourceDescriptor, MediaSourceDiscoveryResult } from '../../media/media-source';
import { CapabilityEvidence } from '../../capabilities/capability-evidence';
import { ConnectionSecretStore } from '../../media/credential-store';
import { MediaSourceLocatorStore } from '../../media/media-locator-store';

function call<T>(run: (callback: (error: Error | null, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => run((error, value) => error ? reject(error) : resolve(value)));
}

/**
 * ONVIF adapter.
 *
 * B7: sourceLocatorRef = ONVIF profile token (opaque, not the RTSP URI).
 *     The actual RTSP URI is reconstructed at resolution time via resolveLocatorUri().
 *
 * B11: executeCapability is implemented for PTZ and relay — only these
 *      capabilities are marked controllable: true.
 *
 * B10: testConnection() accepts raw credentials — does not require a camera to
 *      exist in the database.
 */
export class OnvifAdapter implements CameraMediaProvider, DeviceControlProvider, MediaSourceLocatorStore {
    readonly protocol = 'ONVIF' as const;

    constructor(
        private readonly configRepo: CameraConfigRepository,
        private readonly secretStore: ConnectionSecretStore
    ) {}

    // ── Internal helpers ──────────────────────────────────────────────────────

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
                        port,
                        username: auth.username,
                        password: auth.password,
                    }, (error: Error) => error ? reject(error) : resolve(instance));
                });
                break;
            } catch (err) {
                lastError = err;
            }
        }

        if (!cam) throw lastError ?? new Error('Could not connect to ONVIF device');
        return cam;
    }

    private async connectCamRaw(host: string, port: number, username: string | undefined, password: string | undefined, signal?: AbortSignal) {
        if (signal?.aborted) throw new Error('Aborted');
        const onvif = await import('onvif');
        return new Promise<any>((resolve, reject) => {
            let instance: any;
            instance = new (onvif as any).Cam({
                hostname: host,
                port,
                username: username ?? '',
                password: password ?? '',
            }, (error: Error) => error ? reject(error) : resolve(instance));
        });
    }

    // ── CameraMediaProvider ───────────────────────────────────────────────────

    async getMediaSources(deviceId: string, signal?: AbortSignal): Promise<MediaSourceDiscoveryResult> {
        try {
            const cam = await this.connectCam(deviceId, signal);
            const profiles = await call<any[]>(cb => cam.getProfiles(cb));

            const sources: MediaSourceDescriptor[] = [];

            for (const profile of profiles) {
                const token = profile?.$?.token;
                if (!token) continue;

                // B7: store only the profile token — NOT the RTSP URI.
                // The URI is reconstructed by resolveLocatorUri() at resolve time.
                sources.push({
                    id: token,
                    sourceType: 'onvif',
                    transport: 'tcp',
                    deviceId,
                    // sourceLocatorRef = opaque ONVIF profile token
                    sourceLocatorRef: token,
                    credentialRef: deviceId,
                    profileName: profile.Name || token,
                    profile: token,
                });
            }

            return {
                available: true,
                sources,
                checkedAt: new Date().toISOString(),
            };

        } catch (error) {
            return {
                available: false,
                sources: [],
                reason: (error as Error).message,
                checkedAt: new Date().toISOString(),
            };
        }
    }

    // ── MediaSourceLocatorStore ───────────────────────────────────────────────

    /**
     * B7: Reconstructs the RTSP URI for the given ONVIF descriptor.
     * The returned URI does NOT contain credentials.
     */
    async resolveLocatorUri(descriptor: MediaSourceDescriptor, signal?: AbortSignal): Promise<string> {
        const profileToken = descriptor.sourceLocatorRef;
        if (!profileToken) throw new Error('ONVIF descriptor missing sourceLocatorRef (profile token)');

        const cam = await this.connectCam(descriptor.deviceId, signal);
        const uriResult = await call<any>(cb =>
            cam.getStreamUri({ Protocol: 'RTSP', ProfileToken: profileToken }, cb)
        );
        const rawUri: string = uriResult?.uri || uriResult?.Uri || '';
        if (!rawUri) throw new Error(`No stream URI returned for profile token: ${profileToken}`);

        // Strip credentials that the ONVIF device may embed in the URI —
        // credentials are added later by RtspInputResolver via cameraStreamUrl().
        try {
            const u = new URL(rawUri);
            u.username = '';
            u.password = '';
            return u.toString();
        } catch {
            // If URL parsing fails, return as-is (non-standard formats)
            return rawUri.replace(/:\/{2}[^@]+@/, '://');
        }
    }

    // ── DeviceControlProvider ─────────────────────────────────────────────────

    async listCapabilities(deviceId: string, signal?: AbortSignal): Promise<CapabilityEvidence[]> {
        const evidence: CapabilityEvidence[] = [];
        try {
            const cam = await this.connectCam(deviceId, signal);

            // PTZ — controllable only if nodes AND configurations exist
            const [ptzNodes, ptzConfigurations] = await Promise.all([
                call<any>(cb => cam.getNodes(cb)).catch(() => null),
                call<any>(cb => cam.getConfigurations(cb)).catch(() => null),
            ]);

            const hasPtz = (ptzNodes && ptzNodes.length > 0) && (ptzConfigurations && ptzConfigurations.length > 0);
            if (hasPtz) {
                evidence.push({
                    entity: 'ptz',
                    detected: true,
                    // B11: controllable only because executeCapability('ptz', ...) is implemented below
                    verified: true,
                    readable: true,
                    controllable: true,
                    source: 'onvif-device',
                    confidence: 'verified',
                    operation: 'ptzMove',
                });
            }

            // Motion events — readable, not controllable
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

            // Relay outputs — controllable only if executeCapability('relay', ...) is implemented
            const relays = await call<any>(cb => cam.getRelayOutputs(cb)).catch(() => null);
            if (relays && Array.isArray(relays) && relays.length > 0) {
                evidence.push({
                    entity: 'relay',
                    detected: true,
                    // B11: controllable only because executeCapability('relay', ...) is implemented below
                    verified: true,
                    readable: true,
                    controllable: true,
                    source: 'onvif-device',
                    confidence: 'verified',
                });
            }

        } catch {
            // ignore — return whatever we collected so far
        }

        return evidence;
    }

    /**
     * B11: Real executeCapability for PTZ and relay.
     * Only capabilities marked controllable: true in listCapabilities() are handled here.
     */
    async executeCapability(
        deviceId: string,
        capabilityId: string,
        payload: unknown,
        signal?: AbortSignal
    ): Promise<void> {
        const cam = await this.connectCam(deviceId, signal);

        if (capabilityId === 'ptz' || capabilityId === 'ptzMove') {
            const p = payload as {
                profileToken?: string;
                x?: number;
                y?: number;
                zoom?: number;
                speed?: number;
                durationSeconds?: number;
            };

            if (!p?.profileToken) throw new Error('executeCapability(ptz): profileToken required');

            await call<void>(cb => cam.continuousMove({
                profileToken: p.profileToken,
                velocity: {
                    x: p.x ?? 0,
                    y: p.y ?? 0,
                    zoom: p.zoom ?? 0,
                },
                speed: p.speed,
                timeout: p.durationSeconds ? `PT${p.durationSeconds}S` : undefined,
            }, cb));

            return;
        }

        if (capabilityId === 'relay') {
            const p = payload as { relayToken?: string; state?: 'active' | 'inactive' };
            if (!p?.relayToken) throw new Error('executeCapability(relay): relayToken required');

            await call<void>(cb => cam.setRelayOutputState({
                relayOutputToken: p.relayToken,
                logicalState: p.state ?? 'active',
            }, cb));

            return;
        }

        throw new Error(`executeCapability: capability '${capabilityId}' not supported by OnvifAdapter`);
    }

    // ── B10: testConnection (raw — does not require DB record) ───────────────

    async testConnection(
        host: string,
        port: number,
        username?: string,
        password?: string,
        signal?: AbortSignal
    ): Promise<{ success: boolean; status: string; message: string }> {
        try {
            const cam = await this.connectCamRaw(host, port, username, password, signal);
            // Verify we can fetch at least one profile
            const profiles = await call<any[]>(cb => cam.getProfiles(cb));
            const count = Array.isArray(profiles) ? profiles.length : 0;
            return {
                success: true,
                status: 'ok',
                message: `ONVIF responde en ${host}:${port} — ${count} perfil(es) encontrado(s)`,
            };
        } catch (err: any) {
            return {
                success: false,
                status: 'error',
                message: err.message ?? 'Unknown error',
            };
        }
    }
}
