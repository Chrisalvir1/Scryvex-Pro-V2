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

    private deriveLegacyCameraCapabilities(evidence: CapabilityEvidence[], videoProfiles: StreamProfile[]): Partial<CameraCapabilities> {
        // Derive booleans based on evidence for the UI
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
                motionEvents: evidence.some(e => e.entity === 'motion' && e.readable)
            },
            video: {
                profiles: videoProfiles,
                supportsH264: videoProfiles.some(p => p.normalizedCodec === 'H264'),
                supportsH265: videoProfiles.some(p => p.normalizedCodec === 'H265'),
                supportsTranscoding: false, // Determined elsewhere
                selectedProfileId: videoProfiles.length > 0 ? videoProfiles[0]?.id : undefined
            },
            audio: {
                available: videoProfiles.some(p => !!p.audioCodec),
                input: evidence.some(e => e.entity === 'microphone'),
                output: evidence.some(e => e.entity === 'speaker'),
                codecs: [...new Set(videoProfiles.map(p => p.audioCodec).filter(Boolean) as string[])],
                sampleRates: [...new Set(videoProfiles.map(p => p.audioSampleRate).filter(Boolean) as number[])]
            },
            preview: {
                snapshot: true,
                rtsp: true, // we handle it in our backend
                mjpeg: true,
                webrtc: false,
                hls: true
            }
        };
    }

    async runProbe(cameraId: string) {
        const camera = await this.cameraService.findById(cameraId);
        if (!camera) throw new Error('Camera not found');

        const provider = this.providerRegistry.getProviderForProtocol(camera.protocol || 'RTSP');
        
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
                try {
                    const resolvedInput = await this.resolverRegistry.resolve(source, this.secretStore);
                    const probeResult = await this.mediaProbe.probeMediaStream(resolvedInput);

                    if (resolvedInput.cleanup) await resolvedInput.cleanup();

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
                        probeDurationMs: probeResult.durationMs
                    });

                } catch (e: any) {
                    profiles.push({
                        id: source.id,
                        validationStatus: 'invalid',
                        validationErrorMessage: e.message
                    });
                }
            }
            
            const hkMatrix = evaluateHomeKitCompatibility(cameraId, profiles);
            
            const legacyDerived = this.deriveLegacyCameraCapabilities(evidence, profiles);
            
            const newCapabilities: CameraCapabilities = {
                discoveryStatus: 'online',
                source: camera.protocol?.toLowerCase() as any || 'rtsp',
                capabilityEvidence: evidence,
                video: legacyDerived.video as any,
                audio: legacyDerived.audio as any,
                controls: legacyDerived.controls as any,
                preview: legacyDerived.preview as any,
                yolo: { available: false },
                matter: { available: false, published: false, commissioned: false, supportsMatterRemux: false }
            };

            await this.cameraService.updateDiscovery(
                cameraId, 
                'online', 
                newCapabilities, 
                profiles,
                undefined,
                evidence
            );
            
            await this.cameraService.updateHomeKitCompatibility(cameraId, hkMatrix as unknown as Record<string, unknown>);
            
            await this.cameraService.recordLog(cameraId, 'camera.media.probe.completed', {
                profilesFound: profiles.length
            });
            await this.cameraService.recordLog(cameraId, 'camera.homekit.compatibility.evaluated', {
                isCompatible: hkMatrix.meetsNewAppleRequirements,
                tier: Object.keys(hkMatrix.videoTiers)[0] || 'No asignado'
            });
            await this.cameraService.recordLog(cameraId, 'camera.discovery.completed', { 
                source: newCapabilities.source, 
                profiles: profiles.length 
            });
            
            return newCapabilities;

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            
            await this.cameraService.updateDiscovery(
                cameraId, 
                'error', 
                undefined, 
                undefined, 
                message
            );
            
            await this.cameraService.recordLog(cameraId, 'camera.discovery.failed', { message });
            throw error;
        }
    }

    async getProbeData(cameraId: string) {
        return (await this.cameraService.findById(cameraId))?.capabilities ?? null;
    }

    async toggleHEVC(cameraId: string, enabled: boolean) {
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
                selectedProfileId: selectedId
            }
        };
    }
}
