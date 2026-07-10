import { CameraService } from './camera-service';
import { evaluateHomeKitCompatibility } from '../hksv/compatibility';
import { CapabilityEvidence } from '../capabilities/capability-evidence';
import { CameraProviderRegistry } from '../cameras/camera-provider-registry';
import { MediaProbeService } from '../media/media-probe';
import { MediaInputResolverRegistry } from '../media/media-resolvers';
import { ConnectionSecretStore } from '../media/credential-store';
import { CameraCapabilities, StreamProfile } from '../cameras/camera-adapter';
import { ProbedMediaSource } from '../media/media-source';

export class CameraProbe {
    constructor(
        private readonly cameraService: CameraService,
        private readonly providerRegistry: CameraProviderRegistry,
        private readonly mediaProbe: MediaProbeService,
        private readonly resolverRegistry: MediaInputResolverRegistry,
        private readonly secretStore: ConnectionSecretStore
    ) {}

    // ── Helpers ───────────────────────────────────────────────────────────────

    private deriveLegacyCameraCapabilities(
        evidence: CapabilityEvidence[],
        profiles: StreamProfile[]
    ): Partial<CameraCapabilities> {
        const validVideoProfiles = profiles.filter(p => p.validationStatus === 'valid' && p.normalizedCodec);

        const hasH264 = validVideoProfiles.some(p => p.normalizedCodec === 'H264');
        const hasH265 = validVideoProfiles.some(p => p.normalizedCodec === 'H265');
        const hasAudio = validVideoProfiles.some(p => !!p.audioCodec);

        // B5: canRemux/snapshot/rtsp derived from real validated profiles
        const canRemux = validVideoProfiles.some(p => p.canRemuxVideo);

        // selectedProfileId = highest-resolution validated video profile
        const sorted = [...validVideoProfiles].sort((a, b) => {
            return ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0));
        });
        const selectedProfileId = sorted[0]?.id;

        return {
            controls: {
                ptz: evidence.some(e => e.entity === 'ptz' && e.controllable),
                light: evidence.some(e => e.entity === 'light' && e.readable),
                lightControl: evidence.some(e => e.entity === 'light' && e.controllable),
                microphone: evidence.some(e => e.entity === 'microphone' && e.readable),
                speaker: evidence.some(e => e.entity === 'speaker' && e.controllable),
                twoWayAudio: evidence.some(e => e.entity === 'microphone') && evidence.some(e => e.entity === 'speaker'),
                siren: evidence.some(e => e.entity === 'siren' && e.readable),
                sirenControl: evidence.some(e => e.entity === 'siren' && e.controllable),
                motionEvents: evidence.some(e => e.entity === 'motion' && e.readable),
            },
            video: {
                profiles,
                supportsH264: hasH264,
                supportsH265: hasH265,
                supportsTranscoding: false,
                selectedProfileId,
            },
            audio: {
                available: hasAudio,
                input: evidence.some(e => e.entity === 'microphone'),
                output: evidence.some(e => e.entity === 'speaker'),
                codecs: [...new Set(validVideoProfiles.map(p => p.audioCodec).filter(Boolean) as string[])],
                sampleRates: [...new Set(validVideoProfiles.map(p => p.audioSampleRate).filter(Boolean) as number[])],
            },
            // B5: preview capabilities derived from real validated profiles
            preview: {
                snapshot: validVideoProfiles.length > 0,
                rtsp: validVideoProfiles.length > 0,
                mjpeg: validVideoProfiles.length > 0,
                webrtc: false,
                hls: validVideoProfiles.some(p => p.validationStatus === 'valid'),
                remux: canRemux,
            },
        };
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async runProbe(cameraId: string): Promise<CameraCapabilities> {
        const camera = await this.cameraService.findById(cameraId);
        if (!camera) throw new Error('Camera not found');

        const provider = await this.providerRegistry.getProviderForCamera(cameraId);

        await this.cameraService.updateDiscovery(cameraId, 'pending');
        await this.cameraService.recordLog(cameraId, 'camera.discovery.started', { protocol: camera.protocol || 'RTSP' });
        await this.cameraService.recordLog(cameraId, 'camera.media.probe.started', { protocol: camera.protocol || 'RTSP' });

        try {
            const discovery = await provider.getMediaSources(cameraId);
            if (!discovery.available) throw new Error(`Provider reported unavailable: ${discovery.reason}`);

            const evidence = await provider.listCapabilities(cameraId);

            const profiles: StreamProfile[] = [];
            const probedSources: ProbedMediaSource[] = [];

            for (const source of discovery.sources) {
                let resolvedInput;
                try {
                    resolvedInput = await this.resolverRegistry.resolve(source, this.secretStore);
                    const probeResult = await this.mediaProbe.probeMediaStream(resolvedInput);

                    const profile: StreamProfile = {
                        id: source.id,
                        name: source.profileName || source.id,
                        validationStatus: probeResult.success ? 'valid' : 'invalid',
                        validationErrorCategory: probeResult.errorCategory,
                        validationErrorMessage: probeResult.stderrSummary,
                        validationDurationMs: probeResult.durationMs,
                    };

                    if (probeResult.success && probeResult.rawInfo?.video) {
                        const v = probeResult.rawInfo.video;
                        profile.codec = v.rawCodec;
                        profile.rawCodec = v.rawCodec;
                        profile.normalizedCodec = v.normalizedCodec;
                        profile.displayCodec = v.displayCodec;
                        profile.width = v.width;
                        profile.height = v.height;
                        profile.fps = v.fps;
                        profile.bitrate = v.bitrate;
                        profile.canRemuxVideo = ['H264', 'H265'].includes(v.normalizedCodec);
                    }

                    if (probeResult.success && probeResult.rawInfo?.audio) {
                        const a = probeResult.rawInfo.audio;
                        profile.audioCodec = a.normalizedCodec;
                        profile.audioSampleRate = a.sampleRate;
                        profile.audioChannels = a.channels;
                        profile.audioBitrate = a.bitrate;
                        profile.canRemuxAudio = ['AAC', 'OPUS'].includes(a.normalizedCodec);
                    }

                    profiles.push(profile);
                    probedSources.push({
                        descriptor: source,
                        profile,
                        probeSucceeded: probeResult.success,
                        probeErrorCategory: probeResult.errorCategory,
                        probeDurationMs: probeResult.durationMs,
                    });

                } catch (e: any) {
                    profiles.push({
                        id: source.id,
                        validationStatus: 'invalid',
                        validationErrorMessage: e.message,
                    });
                } finally {
                    // B6: cleanup always runs, even on error
                    if (resolvedInput?.cleanup) {
                        await resolvedInput.cleanup().catch(err =>
                            console.error(`[CameraProbe] cleanup failed for ${cameraId}/${source.id}:`, err)
                        );
                    }
                }
            }

            // B5: only go 'online' if at least one valid profile has video
            const hasValidVideo = profiles.some(p => p.validationStatus === 'valid' && p.normalizedCodec);
            const discoveryStatus = hasValidVideo ? 'online' : 'error';
            const errorMessage = hasValidVideo ? undefined : 'Ningún perfil de video fue validado correctamente';

            const hkMatrix = evaluateHomeKitCompatibility(cameraId, profiles);
            const legacyDerived = this.deriveLegacyCameraCapabilities(evidence, profiles);

            const newCapabilities: CameraCapabilities = {
                // B5: conditional status
                discoveryStatus,
                source: camera.protocol?.toLowerCase() as any || 'rtsp',
                capabilityEvidence: evidence,
                video: legacyDerived.video as any,
                audio: legacyDerived.audio as any,
                controls: legacyDerived.controls as any,
                preview: legacyDerived.preview as any,
                yolo: { available: false },
                matter: { available: false, published: false, commissioned: false, supportsMatterRemux: false },
            };

            await this.cameraService.updateDiscovery(
                cameraId,
                discoveryStatus,
                newCapabilities,
                profiles,
                errorMessage,
                evidence
            );

            await this.cameraService.updateHomeKitCompatibility(cameraId, hkMatrix as unknown as Record<string, unknown>);

            await this.cameraService.recordLog(cameraId, 'camera.media.probe.completed', {
                profilesFound: profiles.length,
                validProfiles: profiles.filter(p => p.validationStatus === 'valid').length,
                discoveryStatus,
            });

            if (hasValidVideo) {
                await this.cameraService.recordLog(cameraId, 'camera.homekit.compatibility.evaluated', {
                    isCompatible: hkMatrix.meetsNewAppleRequirements,
                    tier: Object.keys(hkMatrix.videoTiers)[0] || 'No asignado',
                });
            }

            await this.cameraService.recordLog(cameraId, 'camera.discovery.completed', {
                source: newCapabilities.source,
                profiles: profiles.length,
                status: discoveryStatus,
            });

            return newCapabilities;

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            await this.cameraService.updateDiscovery(cameraId, 'error', undefined, undefined, message);
            await this.cameraService.recordLog(cameraId, 'camera.discovery.failed', { message });
            throw error;
        }
    }

    /**
     * Returns validated stream profiles from DB without running a new probe.
     * Returns null if no probe has been run yet.
     */
    async getProbedSources(cameraId: string): Promise<ProbedMediaSource[] | null> {
        const camera = await this.cameraService.findById(cameraId);
        if (!camera || camera.stream_profiles.length === 0) return null;

        // Reconstruct ProbedMediaSource from persisted stream_profiles
        // Sources are not re-probed here — just materialized from the last probe run.
        const discovery = await (await this.providerRegistry.getProviderForCamera(cameraId)).getMediaSources(cameraId);

        return camera.stream_profiles.map(profile => {
            const descriptor = discovery.sources.find(s => s.id === profile.id);
            return {
                descriptor: descriptor ?? {
                    id: profile.id,
                    sourceType: 'rtsp',
                    transport: 'tcp',
                    deviceId: cameraId,
                    sourceLocatorRef: profile.id,
                    credentialRef: cameraId,
                },
                profile,
                probeSucceeded: profile.validationStatus === 'valid',
                probeErrorCategory: profile.validationErrorCategory,
                probeDurationMs: profile.validationDurationMs,
            } as ProbedMediaSource;
        });
    }

    async getProbeData(cameraId: string): Promise<CameraCapabilities | null> {
        return (await this.cameraService.findById(cameraId))?.capabilities ?? null;
    }

    async toggleHEVC(cameraId: string, enabled: boolean): Promise<CameraCapabilities> {
        const camera = await this.cameraService.findById(cameraId);
        if (!camera?.capabilities.video.profiles.some(p => ['H265', 'HEVC'].includes(p.codec?.toUpperCase() ?? ''))) {
            throw new Error('H.265 no fue detectado por la cámara');
        }

        const selectedId = enabled
            ? camera.capabilities.video.profiles.find(p => ['H265', 'HEVC'].includes(p.codec?.toUpperCase() ?? ''))?.id
            : camera.capabilities.video.profiles.find(p => p.codec?.toUpperCase() === 'H264')?.id;

        return {
            ...camera.capabilities,
            video: {
                ...camera.capabilities.video,
                selectedProfileId: selectedId,
            },
        };
    }
}
