import { spawn } from 'node:child_process';
import type { CameraAdapter, CameraConnectionInput, CameraDiscoveryResult, CameraCapabilities, ConnectionTestResult, StreamProfile } from '../camera-adapter';
import { cameraStreamUrl, emptyCapabilities, redactCameraSecrets } from '../camera-adapter';

function call<T>(run: (callback: (error: Error | null, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => run((error, value) => error ? reject(error) : resolve(value)));
}

function includesCapability(value: unknown, words: string[]) {
    const text = JSON.stringify(value ?? {}).toLowerCase();
    return words.some(word => text.includes(word));
}

interface ProbeStream { codec_name?: string; codec_long_name?: string; width?: number; height?: number; r_frame_rate?: string; bit_rate?: string; sample_rate?: string; codec_type?: string; }

function runProbe(url: string): Promise<{ streams: ProbeStream[] }> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffprobe', ['-v', 'error', '-rtsp_transport', 'tcp', '-rw_timeout', '10000000', '-show_streams', '-show_format', '-of', 'json', url], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
        child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout) as { streams: ProbeStream[] }) : reject(new Error(stderr || `ffprobe terminó con código ${code}`)));
    });
}

function fps(value?: string): number | undefined { if (!value) return undefined; const parts = value.split('/'); return parts.length === 2 ? Number(parts[0]) / Number(parts[1]) : Number(value); }

export class OnvifAdapter implements CameraAdapter {
    readonly protocol = 'ONVIF' as const;

    async discover(input: CameraConnectionInput): Promise<CameraDiscoveryResult> {
        const capabilities = emptyCapabilities('onvif');
        try {
            const onvif = await import('onvif');
            
            const candidates = [...new Set([input.onvif_port ?? input.port, 80, 8080, 8899, 8000, 8001].filter(Boolean))];
            let cam: any;
            let lastError: any;

            for (const port of candidates) {
                try {
                    cam = await new Promise<any>((resolve, reject) => {
                        let instance: any;
                        instance = new (onvif as any).Cam({
                            hostname: input.ip,
                            port: port,
                            username: input.username,
                            password: input.password,
                        }, (error: Error) => error ? reject(error) : resolve(instance));
                    });
                    break; // Connected successfully
                } catch (err) {
                    lastError = err;
                }
            }

            if (!cam) throw lastError;

            const [profiles, information, onvifCapabilities, services] = await Promise.all([
                call<any[]>(callback => cam.getProfiles(callback)),
                call<any>(callback => cam.getDeviceInformation(callback)).catch(() => ({})),
                call<any>(callback => cam.getCapabilities(callback)).catch(() => ({})),
                typeof cam.getServices === 'function' ? call<any>(callback => cam.getServices(true, callback)).catch(() => ({})) : Promise.resolve({}),
            ]);

            const streamProfiles: StreamProfile[] = [];
            for (const [index, profile] of profiles.entries()) {
                const token = profile?.$?.token;
                let streamUri: string | undefined;
                let snapshotUri: string | undefined;
                try { streamUri = (await call<any>(callback => cam.getStreamUri({ protocol: 'RTSP', profileToken: token }, callback)))?.uri; } catch { /* a profile may not expose RTSP */ }
                try { snapshotUri = (await call<any>(callback => cam.getSnapshotUri({ profileToken: token }, callback)))?.uri; } catch { /* snapshots are optional */ }
                
                const video = profile?.videoEncoderConfiguration ?? profile?.VideoEncoderConfiguration;
                const audio = profile?.audioEncoderConfiguration ?? profile?.AudioEncoderConfiguration;
                let codec = video?.encoding ?? video?.Encoding;
                let audioCodec = audio?.encoding ?? audio?.Encoding;
                let sampleRate = audio?.sampleRate ?? audio?.SampleRate;
                let width = video?.resolution?.width ?? video?.Resolution?.Width;
                let height = video?.resolution?.height ?? video?.Resolution?.Height;
                let frameRate = video?.rateControl?.frameRateLimit ?? video?.RateControl?.FrameRateLimit;
                let bitrate = video?.rateControl?.bitrateLimit ?? video?.RateControl?.BitrateLimit;

                // Si hay URL de stream, usamos ffprobe para obtener los valores REALES del hardware
                if (streamUri) {
                    try {
                        const probeUrl = cameraStreamUrl(input, streamUri);
                        const probe = await runProbe(probeUrl);
                        const vStream = probe.streams.find(s => s.codec_type === 'video');
                        const aStreams = probe.streams.filter(s => s.codec_type === 'audio');
                        
                        if (vStream) {
                            codec = vStream.codec_name?.toUpperCase() ?? codec;
                            width = vStream.width ?? width;
                            height = vStream.height ?? height;
                            frameRate = fps(vStream.r_frame_rate) ?? frameRate;
                            bitrate = vStream.bit_rate ? Number(vStream.bit_rate) : bitrate;
                        }
                        if (aStreams.length > 0) {
                            for (const aStream of aStreams) {
                                const ac = aStream.codec_name?.toUpperCase();
                                const sr = aStream.sample_rate ? Number(aStream.sample_rate) : undefined;
                                if (ac && !capabilities.audio.codecs.includes(ac)) capabilities.audio.codecs.push(ac);
                                if (sr && !capabilities.audio.sampleRates.includes(sr)) capabilities.audio.sampleRates.push(sr);
                            }
                        }
                    } catch (e) {
                        // ffprobe failed, we fallback to ONVIF XML values
                    }
                } else {
                    if (typeof audioCodec === 'string' && !capabilities.audio.codecs.includes(audioCodec.toUpperCase())) capabilities.audio.codecs.push(audioCodec.toUpperCase());
                    if (typeof sampleRate === 'number' && !capabilities.audio.sampleRates.includes(sampleRate)) capabilities.audio.sampleRates.push(sampleRate);
                }

                streamProfiles.push({
                    id: token ?? `onvif-${index}`,
                    name: profile?.name ?? profile?.Name,
                    codec: typeof codec === 'string' ? codec.toUpperCase() : undefined,
                    width,
                    height,
                    fps: frameRate,
                    bitrate,
                    streamUri,
                    snapshotUri,
                });
            }

            const ptz = !!(onvifCapabilities?.PTZ ?? onvifCapabilities?.ptz);
            const events = !!(onvifCapabilities?.Events ?? onvifCapabilities?.events);
            const audioInput = includesCapability(onvifCapabilities, ['audiosource', 'audioinput']);
            const audioOutput = includesCapability(onvifCapabilities, ['audiooutput', 'audiodestination']);
            const relayOrAuxiliary = includesCapability(onvifCapabilities, ['relayoutput', 'auxiliarycommands']);
            const advertisedLight = includesCapability([onvifCapabilities, services], ['light', 'floodlight', 'illuminator', 'spotlight', 'lamp']);
            const advertisedSiren = includesCapability([onvifCapabilities, services], ['siren', 'alarm', 'audioalarm']);
            const detectedEntities = [
                ...(ptz ? ['ptz'] : []), ...(events ? ['motion_events'] : []), ...(audioInput ? ['microphone'] : []),
                ...(audioOutput ? ['speaker'] : []), ...(advertisedLight ? ['light'] : []), ...(advertisedSiren ? ['siren'] : []),
            ];

            capabilities.discoveryStatus = 'online';
            capabilities.lastCheckedAt = new Date().toISOString();
            capabilities.manufacturer = information?.Manufacturer ?? information?.manufacturer;
            capabilities.model = information?.Model ?? information?.model;
            capabilities.firmware = information?.FirmwareVersion ?? information?.firmwareVersion;
            capabilities.serialNumber = information?.SerialNumber ?? information?.serialNumber;
            capabilities.detectedEntities = detectedEntities;
            capabilities.video.profiles = streamProfiles;
            capabilities.video.supportsH264 = streamProfiles.some(profile => profile.codec === 'H264' || profile.codec === 'H.264');
            capabilities.video.supportsH265 = streamProfiles.some(profile => profile.codec === 'H265' || profile.codec === 'H.265' || profile.codec === 'HEVC');
            capabilities.video.selectedProfileId = streamProfiles.find(profile => !!profile.streamUri)?.id ?? streamProfiles[0]?.id;
            capabilities.audio.available = capabilities.audio.codecs.length > 0;
            capabilities.audio.input = audioInput;
            capabilities.audio.output = audioOutput;
            capabilities.controls.microphone = audioInput;
            capabilities.controls.speaker = audioOutput;
            capabilities.controls.twoWayAudio = audioInput && audioOutput;
            capabilities.controls.ptz = ptz;
            capabilities.controls.motionEvents = events;
            // ONVIF exposes relays/auxiliary commands but does not semantically
            // label them as a light or siren. Preserve that fact without guessing.
            capabilities.controls.light = advertisedLight;
            capabilities.controls.lightControl = advertisedLight && relayOrAuxiliary;
            capabilities.controls.siren = advertisedSiren;
            capabilities.controls.sirenControl = advertisedSiren && relayOrAuxiliary;
            capabilities.preview.snapshot = streamProfiles.some(profile => !!profile.snapshotUri);
            capabilities.preview.rtsp = streamProfiles.some(profile => !!profile.streamUri);
            capabilities.preview.mjpeg = capabilities.preview.rtsp;
            capabilities.matter.supportsMatterRemux = capabilities.video.supportsH264 || capabilities.video.supportsH265;
            capabilities.matter.available = true;
            capabilities.matter.reason = undefined;
            return { capabilities, streamProfiles };
        } catch (error) {
            capabilities.discoveryStatus = /unauthorized|authentication|not authorized|401/i.test(error instanceof Error ? error.message : String(error)) ? 'authentication_failed' : 'error';
            capabilities.lastCheckedAt = new Date().toISOString();
            throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { capabilities });
        }
    }

    async getCapabilities(input: CameraConnectionInput): Promise<CameraCapabilities> { return (await this.discover(input)).capabilities; }
    async testConnection(input: CameraConnectionInput): Promise<ConnectionTestResult> {
        try { const result = await this.discover(input); return { success: true, status: result.capabilities.discoveryStatus }; }
        catch (error) { return { success: false, status: (error as { capabilities?: CameraCapabilities }).capabilities?.discoveryStatus ?? 'error', message: error instanceof Error ? error.message : String(error) }; }
    }
}
