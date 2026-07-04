import sdk, { Camera, DeviceCreator, DeviceCreatorSettings, DeviceProvider, MediaObject, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera } from "@scrypted/sdk";
import { randomBytes } from "crypto";

const { deviceManager } = sdk;

export interface UrlMediaStreamOptions extends ResponseMediaStreamOptions {
    url: string;
    /**
     * Hint to HomeKit and RTSP/ONVIF plugins that this stream is the preferred
     * one for HomeKit delivery (e.g. it has been manually designated or
     * auto-detected as the best match).
     */
    homekitPreferred?: boolean;
    /**
     * Indicates the stream can be forwarded to HomeKit without re-encoding the
     * video track (i.e. the source is already H.264-compatible).
     */
    directRemux?: boolean;
    /**
     * The raw codec identifier as reported by the camera (e.g. "h264", "h265",
     * "hevc"). Used to make safe remux decisions even when the normalised codec
     * field has been coerced.
     */
    sourceCodec?: string;
}

function normalizeCodec(codec?: string): string | undefined {
    const lower = codec?.trim().toLowerCase();
    if (!lower)
        return undefined;
    if (lower === 'avc' || lower.includes('h264') || lower.includes('h.264'))
        return 'h264';
    if (lower === 'hevc' || lower.includes('h265') || lower.includes('h.265'))
        return 'h265';
    return lower;
}

function describeStream(vso: ResponseMediaStreamOptions): string {
    const video = vso.video?.codec || (vso as UrlMediaStreamOptions).sourceCodec || 'unknown';
    const audio = vso.audio === null ? 'none' : vso.audio?.codec || 'unknown';
    const width = vso.video?.width;
    const height = vso.video?.height;
    const resolution = width && height ? `${width}x${height}` : 'unknown resolution';
    const directRemux = !!(vso as UrlMediaStreamOptions).directRemux;
    const preferred = !!(vso as UrlMediaStreamOptions).homekitPreferred;
    return `${vso.name || vso.id || 'Stream'}: video=${video}, audio=${audio}, ${resolution}, container=${vso.container || 'unknown'}, directRemux=${directRemux}, homekitPreferred=${preferred}`;
}

/**
 * Compute a HomeKit-compatibility score for a stream so callers can pick the
 * best available stream without transcoding.
 *
 * Scoring priority (highest wins):
 *   1. homekitPreferred flag (explicit user/plugin preference)
 *   2. directRemux flag (video copy is safe)
 *   3. H.264 codec (native HomeKit codec)
 *   4. Resolution (higher = better, within HomeKit limits)
 *   5. H.265/HEVC (secondary fallback only)
 *
 * Safe for single-stream cameras: always returns a positive value.
 */
export function scoreHomeKitStream(vso: UrlMediaStreamOptions): number {
    let score = 0;

    if (vso.homekitPreferred)
        score += 10000;

    if (vso.directRemux)
        score += 1000;

    const codec = (vso.video?.codec || vso.sourceCodec || '').toLowerCase();
    if (codec.includes('h264') || codec === 'avc')
        score += 500;
    else if (codec.includes('h265') || codec.includes('hevc'))
        score += 50; // usable only as fallback

    // Resolution: reward higher pixel count, but cap contribution to avoid
    // letting a massive-resolution H.265 stream outrank a lower-res H.264 one.
    const width = vso.video?.width || 0;
    const height = vso.video?.height || 0;
    if (width && height) {
        const pixels = width * height;
        // Scale so 1080p (≈2M px) contributes ~200 points, 4K ~400 — never
        // enough to flip H.264 vs H.265 decision alone.
        score += Math.min(400, Math.round(pixels / 10000));
    }

    return score;
}


export abstract class CameraBase<T extends ResponseMediaStreamOptions> extends ScryptedDeviceBase implements Camera, VideoCamera, Settings {
    constructor(nativeId: string, public provider: CameraProviderBase<T>) {
        super(nativeId);
    }

    takePicture(option?: PictureOptions): Promise<MediaObject> {
        throw new Error("The RTSP Camera does not provide snapshots. Install the Snapshot Plugin if snapshots are available via an URL.");
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return [];
    }

    async getVideoStreamOptions(): Promise<T[]> {
        const vsos = this.getRawVideoStreamOptions();
        return this.applyHomeKitStreamSettings(vsos);
    }

    abstract getRawVideoStreamOptions(): T[];

    async getVideoStream(options?: T): Promise<MediaObject> {
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos?.find(s => s.id === options?.id) || this.getDefaultStream(vsos);
        return this.createVideoStream(vso);
    }

    abstract createVideoStream(options?: T): Promise<MediaObject>;

    async getUrlSettings(): Promise<Setting[]> {
        return [
        ];
    }

    getUsername() {
        return this.storage.getItem('username');
    }

    getPassword() {
        return this.storage.getItem('password');
    }

    async getOtherSettings(): Promise<Setting[]> {
        return [];
    }

    getDefaultStream(vsos: T[]) {
        return vsos?.[0];
    }

    async getStreamSettings(): Promise<Setting[]> {
        const vsos = await this.getVideoStreamOptions().catch(() => []);
        const diagnostics = vsos?.length
            ? vsos.map(describeStream).join('\n')
            : 'No stream options detected yet. Use Log Stream Diagnostics, verify credentials, or check the camera plugin logs.';

        return [
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'streamDiagnostics',
                title: 'Detected Streams',
                type: 'textarea',
                readonly: true,
                value: diagnostics,
                description: 'Current stream metadata used by preview, WebRTC, and HomeKit 27 export.',
            },
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'videoCodec',
                title: 'Video Codec Override',
                description: 'Use Auto unless detection is wrong. H.264 enables direct remux; H.265/HEVC is kept as HEVC for HomeKit 27.',
                value: this.storage.getItem('videoCodec') || '',
                choices: [
                    '',
                    'h264',
                    'h265',
                ],
                combobox: true,
            },
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'audioCodec',
                title: 'Audio Codec Override',
                description: 'Use Auto unless detection is wrong. Opus can be passed through when compatible; PCM/AAC may need transcoding.',
                value: this.storage.getItem('audioCodec') || '',
                choices: [
                    '',
                    'aac',
                    'opus',
                    'pcm_mulaw',
                    'pcm_alaw',
                ],
                combobox: true,
            },
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'directRemuxMode',
                title: 'Remux Mode',
                description: 'Auto is recommended. Force only when you know the stream is already HomeKit-compatible.',
                value: this.storage.getItem('directRemuxMode') || 'Auto',
                choices: [
                    'Auto',
                    'Force Direct Remux',
                    'Disable Direct Remux',
                ],
            },
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'homekitPreferred',
                title: 'Prefer This Camera Stream For HomeKit',
                description: 'Marks this camera stream as preferred when HomeKit 27 asks for video.',
                type: 'boolean',
                value: this.storage.getItem('homekitPreferred') === 'true',
            },
            {
                group: 'HomeKit',
                subgroup: 'Codec / Remux',
                key: 'logStreamDiagnostics',
                title: 'Log Stream Diagnostics',
                type: 'button',
                description: 'Writes stream codec/remux metadata to this camera console without exposing RTSP passwords.',
            },
        ];
    }

    applyHomeKitStreamSettings(vsos: T[]): T[] {
        if (!vsos)
            return vsos;

        const videoCodec = normalizeCodec(this.storage.getItem('videoCodec') || undefined);
        const audioCodec = normalizeCodec(this.storage.getItem('audioCodec') || undefined) || this.storage.getItem('audioCodec') || undefined;
        const directRemuxMode = this.storage.getItem('directRemuxMode') || 'Auto';
        const homekitPreferred = this.storage.getItem('homekitPreferred') === 'true';

        for (const vso of vsos as (T & UrlMediaStreamOptions)[]) {
            const detectedVideoCodec = normalizeCodec(vso.video?.codec || vso.sourceCodec);
            const effectiveVideoCodec = videoCodec || detectedVideoCodec;

            if (effectiveVideoCodec) {
                vso.video ||= {};
                vso.video.codec = effectiveVideoCodec;
                vso.sourceCodec ||= effectiveVideoCodec;
            }

            if (audioCodec && vso.audio !== null) {
                vso.audio ||= {};
                vso.audio.codec = audioCodec;
            }

            if (directRemuxMode === 'Force Direct Remux')
                vso.directRemux = true;
            else if (directRemuxMode === 'Disable Direct Remux')
                vso.directRemux = false;
            else
                vso.directRemux = effectiveVideoCodec === 'h264';

            if (homekitPreferred || effectiveVideoCodec === 'h264' || effectiveVideoCodec === 'h265')
                vso.homekitPreferred = true;
        }

        return vsos;
    }

    async logStreamDiagnostics() {
        try {
            const vsos = await this.getVideoStreamOptions();
            this.console.log(`[camera diagnostics] ${this.name || this.id}: ${vsos?.length || 0} stream option(s)`);
            for (const vso of vsos || [])
                this.console.log('[camera diagnostics]', describeStream(vso));
        }
        catch (e) {
            this.console.error(`[camera diagnostics] failed to read stream options for ${this.name || this.id}`, e);
        }
    }

    getUsernameDescription(): string {
        return 'Optional: Username for snapshot http requests.';
    }

    getPasswordDescription(): string {
        return 'Optional: Password for snapshot http requests.';
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [
            {
                key: 'username',
                title: 'Username',
                value: this.getUsername(),
                description: this.getUsernameDescription(),
            },
            {
                key: 'password',
                title: 'Password',
                value: this.getPassword(),
                type: 'password',
                description: this.getPasswordDescription(),
            },
            ...await this.getUrlSettings(),
            ...await this.getStreamSettings(),
            ...await this.getOtherSettings(),
        ];

        for (const s of ret) {
            s.group = this.provider?.name?.replace('Plugin', '').trim() || '';
            s.subgroup ||= 'General';
        }

        return ret;
    }

    async putSettingBase(key: string, value: SettingValue) {
        if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id || '');
        }
        else if ([
            'videoCodec',
            'audioCodec',
            'directRemuxMode',
            'homekitPreferred',
        ].includes(key)) {
            this.storage.setItem(key, value?.toString() || '');
        }
        else if (key === 'logStreamDiagnostics') {
            await this.logStreamDiagnostics();
        }
        else {
            this.storage.setItem(key, value?.toString() || '');
        }

        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async putSetting(key: string, value: SettingValue) {
        this.putSettingBase(key, value);
    }
}

export abstract class CameraProviderBase<T extends ResponseMediaStreamOptions> extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.systemDevice = {
            deviceCreator: this.getScryptedDeviceCreator(),
        };
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: ScryptedNativeId): Promise<string> {
        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.newCamera?.toString() || 'New Camera';
        await this.updateDevice(nativeId, name, this.getInterfaces());
        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'newCamera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    getAdditionalInterfaces(): string[] {
        return [
        ];
    }

    getInterfaces() {
        return [
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings,
            ...this.getAdditionalInterfaces()
        ];
    }

    updateDevice(nativeId: string, name: string, interfaces: string[], type?: ScryptedDeviceType) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces,
            type: type || ScryptedDeviceType.Camera,
            info: deviceManager.getNativeIds().includes(nativeId) ? deviceManager.getDeviceState(nativeId)?.info : undefined,
        });
    }

    abstract createCamera(nativeId: string): CameraBase<T>;
    abstract getScryptedDeviceCreator(): string;

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId);
    }
}
