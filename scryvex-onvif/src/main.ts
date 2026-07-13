import net, { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import sdk, {
    DeviceCreator,
    DeviceCreatorSettings,
    DeviceProvider,
    MediaObject,
    MediaStreamOptions,
    MediaStreamUrl,
    ResponseMediaStreamOptions,
    ScryptedDeviceBase,
    ScryptedDeviceType,
    ScryptedInterface,
    ScryptedMimeTypes,
    Setting,
    SettingValue,
    Settings,
    VideoCamera,
} from '@scrypted/sdk';
import { Cam } from 'onvif';

const BACKCHANNEL_REQUIRE = 'www.onvif.org/ver20/backchannel';

type OnvifProfile = {
    token?: string;
    name?: string;
    videoEncoderConfiguration?: {
        encoding?: string;
        resolution?: { width?: number; height?: number };
        rateControl?: { frameRateLimit?: number; bitrateLimit?: number };
    };
    audioEncoderConfiguration?: {
        encoding?: string;
        bitrate?: number;
        sampleRate?: number;
    };
};

type StreamDescriptor = {
    uri: string;
    profile: OnvifProfile;
};

function once<T>(fn: (callback: (error: Error | null, value: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => fn((error, value) => error ? reject(error) : resolve(value)));
}

function normalizeCodec(codec?: string) {
    switch (codec?.toLowerCase()) {
        case 'h265':
        case 'hevc':
            return 'h265';
        case 'h264':
        case 'avc':
            return 'h264';
    }
}

function normalizeAudioCodec(codec?: string) {
    switch (codec?.toLowerCase()) {
        case 'aac':
        case 'mpeg4-generic':
            return 'aac';
        case 'opus':
            return 'opus';
        case 'g711':
        case 'pcma':
            return 'pcma';
        case 'pcmu':
            return 'pcmu';
    }
}

class ScryvexOnvifCamera extends ScryptedDeviceBase implements VideoCamera, Settings {
    constructor(public readonly provider: ScryvexOnvifProvider, nativeId: string) {
        super(nativeId);
    }

    private get host() {
        return this.storage.getItem('host');
    }

    private get port() {
        return Number(this.storage.getItem('port') || '80');
    }

    private get username() {
        return this.storage.getItem('username') || '';
    }

    private get password() {
        return this.storage.getItem('password') || '';
    }

    private get profileToken() {
        return this.storage.getItem('profileToken') || '';
    }

    get injectBackchannelRequire() {
        return this.storage.getItem('injectBackchannelRequire') !== 'false';
    }

    get basicAuthorization() {
        if (!this.username)
            return undefined;
        return `Basic ${Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64')}`;
    }

    private async openOnvifCamera(): Promise<any> {
        if (!this.host)
            throw new Error('Set the ONVIF host before requesting a stream.');

        return new Promise<any>((resolve, reject) => {
            new Cam({
                hostname: this.host,
                port: this.port,
                username: this.username || undefined,
                password: this.password || undefined,
                timeout: 10000,
            }, (error: Error, camera: any) => error ? reject(error) : resolve(camera));
        });
    }

    private async getProfiles(): Promise<OnvifProfile[]> {
        const camera = await this.openOnvifCamera();
        return once<OnvifProfile[]>((callback) => camera.getProfiles(callback));
    }

    async getStreamDescriptor(): Promise<StreamDescriptor> {
        const camera = await this.openOnvifCamera();
        const profiles = await once<OnvifProfile[]>((callback) => camera.getProfiles(callback));
        const profile = profiles.find(candidate => candidate.token === this.profileToken) || profiles[0];
        if (!profile?.token)
            throw new Error('The ONVIF camera did not expose a media profile.');

        const stream = await once<any>((callback) => camera.getStreamUri({ profileToken: profile.token, protocol: 'RTSP' }, callback));
        if (!stream?.uri)
            throw new Error('The ONVIF camera did not return an RTSP URI.');

        return { uri: stream.uri, profile };
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const profiles = await this.getProfiles();
        return profiles.map((profile, index) => ({
            id: profile.token || `profile-${index}`,
            name: profile.name || `ONVIF profile ${index + 1}`,
            container: 'rtsp',
            video: {
                codec: normalizeCodec(profile.videoEncoderConfiguration?.encoding),
                width: profile.videoEncoderConfiguration?.resolution?.width,
                height: profile.videoEncoderConfiguration?.resolution?.height,
                fps: profile.videoEncoderConfiguration?.rateControl?.frameRateLimit,
                bitrate: profile.videoEncoderConfiguration?.rateControl?.bitrateLimit,
            },
            audio: {
                codec: normalizeAudioCodec(profile.audioEncoderConfiguration?.encoding),
                bitrate: profile.audioEncoderConfiguration?.bitrate,
                sampleRate: profile.audioEncoderConfiguration?.sampleRate,
            },
            userConfigurable: true,
        } as ResponseMediaStreamOptions));
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const descriptor = await this.getStreamDescriptor();
        const streamOptions = (await this.getVideoStreamOptions()).find(option => option.id === options?.id)
            || (await this.getVideoStreamOptions())[0];
        if (!streamOptions)
            throw new Error('The ONVIF camera does not have a selectable stream.');

        const proxyUrl = await this.provider.getProxyUrl(this);
        const mediaStreamUrl: MediaStreamUrl = {
            container: 'rtsp',
            url: proxyUrl,
            mediaStreamOptions: {
                ...streamOptions,
                refreshAt: Date.now() + 60_000,
                metadata: {
                    scryvexOnvif: true,
                    upstreamUri: descriptor.uri,
                    remuxOnly: true,
                },
            },
        };
        return this.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl);
    }

    async getSettings(): Promise<Setting[]> {
        const settings: Setting[] = [
            { key: 'host', title: 'ONVIF host or IP address', placeholder: '192.168.1.100', value: this.host },
            { key: 'port', title: 'ONVIF port', type: 'number', value: this.port },
            { key: 'username', title: 'Username', value: this.username },
            { key: 'password', title: 'Password', type: 'password', value: this.password },
            {
                key: 'injectBackchannelRequire',
                title: 'Send ONVIF backchannel Require header',
                description: 'Enable only for cameras whose firmware closes a normal RTSP DESCRIBE request. This does not enable two-way audio.',
                type: 'boolean',
                value: this.injectBackchannelRequire,
            },
        ];

        try {
            const profiles = await this.getProfiles();
            settings.push({
                key: 'profileToken',
                title: 'Video profile',
                description: 'The real ONVIF profile. Codec and resolution are read from the camera; no video transcoding is performed.',
                choices: profiles.map(profile => profile.token).filter((token): token is string => !!token),
                value: this.profileToken || profiles[0]?.token,
            });
        }
        catch (error) {
            settings.push({
                key: 'connectionStatus',
                title: 'ONVIF discovery status',
                readonly: true,
                value: error instanceof Error ? error.message : String(error),
            });
        }

        settings.push({
            key: 'streamPolicy',
            title: 'Video policy',
            readonly: true,
            value: 'Remux only — the camera codec is preserved; H.264 and H.265 are never converted.',
        });
        return settings;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        if (key === 'connectionStatus' || key === 'streamPolicy')
            return;
        this.storage.setItem(key, String(value));
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        this.onDeviceEvent(ScryptedInterface.VideoCamera, undefined);
    }
}

class ScryvexOnvifProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    private readonly devices = new Map<string, ScryvexOnvifCamera>();
    private readonly proxy: net.Server;
    private readonly proxyReady: Promise<number>;

    constructor() {
        super();
        this.proxy = net.createServer(socket => void this.handleProxyConnection(socket));
        this.proxyReady = new Promise<number>((resolve, reject) => {
            this.proxy.once('error', reject);
            this.proxy.listen(0, '127.0.0.1', () => {
                this.proxy.off('error', reject);
                resolve((this.proxy.address() as AddressInfo).port);
            });
        });
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            { key: 'name', title: 'Camera name', placeholder: 'Front Door' },
            { key: 'host', title: 'ONVIF host or IP address', placeholder: '192.168.1.100' },
            { key: 'port', title: 'ONVIF port', type: 'number', value: 80 },
            { key: 'username', title: 'Username' },
            { key: 'password', title: 'Password', type: 'password' },
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = `scryvex-onvif-${crypto.randomUUID()}`;
        await sdk.deviceManager.onDeviceDiscovered({
            nativeId,
            name: String(settings.name || 'Scryvex ONVIF Camera'),
            type: ScryptedDeviceType.Camera,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
            ],
            info: {
                manufacturer: 'Scryvex Pro',
                model: 'Scryvex ONVIF',
                ip: String(settings.host || ''),
            },
        });
        const device = await this.getDevice(nativeId);
        for (const [key, value] of Object.entries(settings))
            await device.putSetting(key, value);
        return nativeId;
    }

    async getDevice(nativeId: string): Promise<ScryvexOnvifCamera> {
        let device = this.devices.get(nativeId);
        if (!device) {
            device = new ScryvexOnvifCamera(this, nativeId);
            this.devices.set(nativeId, device);
        }
        return device;
    }

    async releaseDevice(_id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId);
    }

    async getProxyUrl(camera: ScryvexOnvifCamera): Promise<string> {
        const port = await this.proxyReady;
        return `rtsp://127.0.0.1:${port}/${encodeURIComponent(String(camera.nativeId))}`;
    }

    private async handleProxyConnection(client: net.Socket): Promise<void> {
        try {
            const firstRequest = await this.readRtspRequest(client);
            const nativeId = this.getNativeId(firstRequest);
            const camera = nativeId && await this.getDevice(nativeId);
            if (!camera)
                throw new Error('Unknown Scryvex ONVIF proxy camera.');

            const descriptor = await camera.getStreamDescriptor();
            const upstream = new URL(descriptor.uri);
            const upstreamPort = Number(upstream.port || 554);
            const upstreamSocket = net.createConnection({ host: upstream.hostname, port: upstreamPort });
            await new Promise<void>((resolve, reject) => {
                upstreamSocket.once('connect', resolve);
                upstreamSocket.once('error', reject);
            });

            const localBase = `rtsp://127.0.0.1:${await this.proxyReady}/${encodeURIComponent(String(camera.nativeId))}`;
            const rewrite = (request: Buffer) => this.rewriteRequest(
                request,
                localBase,
                descriptor.uri,
                camera.injectBackchannelRequire,
                camera.basicAuthorization,
            );
            upstreamSocket.write(rewrite(firstRequest));
            upstreamSocket.on('data', (response: Buffer) => {
                if (/WWW-Authenticate:\s*Digest/i.test(response.toString('utf8')))
                    this.console.error('The camera requested RTSP Digest authentication. This early adapter supports Basic authentication only; no video will be exposed until Digest negotiation is implemented.');
                client.write(response);
            });
            this.pipeRequests(client, upstreamSocket, rewrite);
            const close = () => {
                client.destroy();
                upstreamSocket.destroy();
            };
            client.once('error', close);
            upstreamSocket.once('error', close);
            client.once('close', () => upstreamSocket.destroy());
            upstreamSocket.once('close', () => client.destroy());
        }
        catch (error) {
            this.console.error('Scryvex ONVIF RTSP proxy connection failed:', error instanceof Error ? error.message : error);
            client.destroy();
        }
    }

    private getNativeId(request: Buffer): string | undefined {
        const firstLine = request.toString('utf8').split('\r\n', 1)[0];
        const uri = firstLine?.split(' ')[1];
        try {
            const path = new URL(uri).pathname.replace(/^\//, '');
            return decodeURIComponent(path.split('/')[0]);
        }
        catch {
            return undefined;
        }
    }

    private async readRtspRequest(socket: net.Socket): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            let data = Buffer.alloc(0);
            const onData = (chunk: Buffer) => {
                data = Buffer.concat([data, chunk]);
                const end = data.indexOf('\r\n\r\n');
                if (end === -1)
                    return;
                cleanup();
                const request = data.subarray(0, end + 4);
                const remainder = data.subarray(end + 4);
                if (remainder.length)
                    socket.unshift(remainder);
                resolve(request);
            };
            const onError = (error: Error) => { cleanup(); reject(error); };
            const onClose = () => { cleanup(); reject(new Error('RTSP client closed before its first request.')); };
            const cleanup = () => {
                socket.off('data', onData);
                socket.off('error', onError);
                socket.off('close', onClose);
            };
            socket.on('data', onData);
            socket.once('error', onError);
            socket.once('close', onClose);
        });
    }

    private pipeRequests(client: net.Socket, upstream: net.Socket, rewrite: (request: Buffer) => Buffer) {
        let buffered = Buffer.alloc(0);
        client.on('data', (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            while (buffered.length) {
                if (buffered[0] === 0x24) { // RTP/RTCP interleaved data: pass it untouched.
                    upstream.write(buffered);
                    buffered = Buffer.alloc(0);
                    return;
                }
                const end = buffered.indexOf('\r\n\r\n');
                if (end === -1)
                    return;
                upstream.write(rewrite(buffered.subarray(0, end + 4)));
                buffered = buffered.subarray(end + 4);
            }
        });
    }

    private rewriteRequest(request: Buffer, localBase: string, upstreamUri: string, injectRequire: boolean, basicAuthorization?: string): Buffer {
        let text = request.toString('utf8');
        const [firstLine, ...headerLines] = text.split('\r\n');
        const [method, requestUri, protocol] = firstLine.split(' ');
        const rewrittenUri = requestUri.startsWith(localBase)
            ? `${upstreamUri}${requestUri.slice(localBase.length)}`
            : requestUri;
        const hasRequire = headerLines.some(line => /^Require:/i.test(line));
        const hasAuthorization = headerLines.some(line => /^Authorization:/i.test(line));
        if (method === 'DESCRIBE' && injectRequire && !hasRequire)
            headerLines.splice(Math.max(0, headerLines.length - 1), 0, `Require: ${BACKCHANNEL_REQUIRE}`);
        if (basicAuthorization && !hasAuthorization)
            headerLines.splice(Math.max(0, headerLines.length - 1), 0, `Authorization: ${basicAuthorization}`);
        text = `${method} ${rewrittenUri} ${protocol}\r\n${headerLines.join('\r\n')}`;
        return Buffer.from(text, 'utf8');
    }
}

export default ScryvexOnvifProvider;
