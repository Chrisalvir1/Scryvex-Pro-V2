import type { Readable } from 'stream';
import { MediaSourceDescriptor, MediaOperationError } from './media-source';
import { ConnectionSecretStore } from './credential-store';
import { cameraStreamUrl } from '../cameras/camera-adapter';

export interface ResolvedMediaInput {
    kind: 'rtsp' | 'http' | 'hls' | 'webrtc' | 'pipe' | 'buffer';
    /** FFmpeg/FFprobe input arguments. For pipe/buffer sources, includes '-i pipe:0'. */
    ffmpegInputArguments: string[];
    probeStrategy: 'ffprobe' | 'buffer_magic' | 'webrtc_analyzer';
    redactedDescription: string;
    /** Stream to pipe into FFmpeg stdin. Requires stdio[0]='pipe'. */
    inputStream?: Readable;
    /** Buffer to feed into FFmpeg stdin. */
    inputBuffer?: Buffer;
    /** Factory for re-creating the input stream on retry. */
    inputFactory?: (signal?: AbortSignal) => Promise<Readable>;
    /** MIME type of the source (from plugin MediaObject). */
    mimeType?: string;
    /** Must always be called in a finally block. async and idempotent. */
    cleanup?: () => Promise<void>;
}

export interface MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean;
    resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput>;
}

export class MediaInputResolverRegistry {
    private resolvers: MediaInputResolver[] = [];

    register(resolver: MediaInputResolver): void {
        this.resolvers.push(resolver);
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        for (const resolver of this.resolvers) {
            if (resolver.canResolve(descriptor)) {
                return resolver.resolve(descriptor, secretStore, signal);
            }
        }
        throw new MediaOperationError(
            `No resolver for sourceType: ${descriptor.sourceType} transport: ${descriptor.transport}`,
            'not_retryable'
        );
    }
}

/** Resolves RTSP/ONVIF sources */
export class RtspInputResolver implements MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'rtsp' || descriptor.sourceType === 'onvif';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        if (!descriptor.sourceLocatorRef) {
            throw new MediaOperationError('RTSP source missing sourceLocatorRef', 'not_retryable');
        }

        const auth = descriptor.credentialRef
            ? await secretStore.resolveAuthorization(descriptor.credentialRef, signal)
            : { type: 'none' as const };

        // sourceLocatorRef for RTSP is the raw URI stored in camera config
        const baseUrl = descriptor.sourceLocatorRef;
        let resolvedUrl: string;

        try {
            resolvedUrl = cameraStreamUrl(
                { username: auth.username, password: auth.password },
                baseUrl
            );
        } catch (e) {
            throw new MediaOperationError(`URI malformada: ${(e as Error).message}`, 'not_retryable');
        }

        const transport = descriptor.transport === 'udp' ? 'udp' : 'tcp';
        const ffmpegArgs = [
            '-rtsp_transport', transport,
            '-rw_timeout', '10000000',
            '-i', resolvedUrl,
        ];

        return {
            kind: 'rtsp',
            ffmpegInputArguments: ffmpegArgs,
            probeStrategy: 'ffprobe',
            redactedDescription: resolvedUrl.replace(/:\/\/[^@]+@/, '://***:***@'),
        };
    }
}

/** Resolves HTTP/HTTPS snapshot or stream URLs */
export class HttpInputResolver implements MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'http' && (
            descriptor.transport === 'http' || descriptor.transport === 'https'
        );
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        if (!descriptor.sourceLocatorRef) {
            throw new MediaOperationError('HTTP source missing sourceLocatorRef', 'not_retryable');
        }

        const auth = descriptor.credentialRef
            ? await secretStore.resolveAuthorization(descriptor.credentialRef, signal)
            : { type: 'none' as const };

        const headers: string[] = [];
        if (auth.type === 'bearer' && auth.token) {
            headers.push('-headers', `Authorization: Bearer ${auth.token}\r\n`);
        } else if (auth.type === 'headers' && auth.headers) {
            for (const [k, v] of Object.entries(auth.headers)) {
                headers.push('-headers', `${k}: ${v}\r\n`);
            }
        }

        const url = descriptor.sourceLocatorRef;

        return {
            kind: 'http',
            ffmpegInputArguments: [...headers, '-i', url],
            probeStrategy: 'ffprobe',
            redactedDescription: url.replace(/[?&](token|auth|key|pass)=[^&]+/gi, '?$1=***'),
        };
    }
}

/** Resolves HLS streams */
export class HlsInputResolver implements MediaInputResolver {
    // Allowed extensions — no wildcard
    private static readonly ALLOWED_EXTENSIONS = ['m3u8', 'ts', 'm4s', 'aac', 'mp4'];

    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'hls';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        if (!descriptor.sourceLocatorRef) {
            throw new MediaOperationError('HLS source missing sourceLocatorRef', 'not_retryable');
        }

        const url = descriptor.sourceLocatorRef;
        return {
            kind: 'hls',
            ffmpegInputArguments: [
                '-allowed_extensions', HlsInputResolver.ALLOWED_EXTENSIONS.join(','),
                '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
                '-i', url,
            ],
            probeStrategy: 'ffprobe',
            redactedDescription: url.replace(/[?&](token|auth|key|pass)=[^&]+/gi, '?$1=***'),
        };
    }
}

/** Resolves pipe-based sources (e.g. stdin from plugin) */
export class PipeInputResolver implements MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'plugin_pipe';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        return {
            kind: 'pipe',
            ffmpegInputArguments: ['-i', 'pipe:0'],
            probeStrategy: 'buffer_magic',
            redactedDescription: `Plugin[${descriptor.pluginId}] pipe`,
            mimeType: 'application/octet-stream',
        };
    }
}

/** Resolves in-memory buffer sources */
export class BufferInputResolver implements MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'plugin_buffer';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        return {
            kind: 'buffer',
            ffmpegInputArguments: ['-i', 'pipe:0'],
            probeStrategy: 'buffer_magic',
            redactedDescription: `Plugin[${descriptor.pluginId}] buffer`,
        };
    }
}

/** WebRTC: explicitly unsupported in this runtime */
export class WebRtcInputResolver implements MediaInputResolver {
    canResolve(descriptor: MediaSourceDescriptor): boolean {
        return descriptor.sourceType === 'webrtc';
    }

    async resolve(
        descriptor: MediaSourceDescriptor,
        secretStore: ConnectionSecretStore,
        signal?: AbortSignal
    ): Promise<ResolvedMediaInput> {
        throw new MediaOperationError(
            'WebRTC input requires browser-side SDP negotiation; unsupported in server-side FFmpeg pipeline',
            'not_retryable'
        );
    }
}
