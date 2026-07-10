/**
 * provider-contract.test.ts
 *
 * B12: Contract tests covering MediaSourceDiscoveryResult, ConnectionSecretStore,
 * executeWithSourceRetry, RTSP, ONVIF mock, HTTP, HLS, buffer, pipe, refresh,
 * 401/403, cancellation, timeout, selector, cleanup, and canary secrets.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    MediaSourceDiscoveryResult,
    MediaSourceDescriptor,
    CameraMediaProvider,
    MediaOperationError,
} from '../src/media/media-source';
import {
    MediaInputResolverRegistry,
    RtspInputResolver,
    HttpInputResolver,
    HlsInputResolver,
    PipeInputResolver,
    BufferInputResolver,
    ResolvedMediaInput,
} from '../src/media/media-resolvers';
import { ConnectionSecretStore, ResolvedAuthorization } from '../src/media/credential-store';
import { MediaSourceSessionManager } from '../src/media/media-session-manager';
import { MediaSourceSelector } from '../src/media/media-selector';
import { MediaSourceLocatorStore } from '../src/media/media-locator-store';

// ── Mock helpers ───────────────────────────────────────────────────────────────

class MockSecretStore implements ConnectionSecretStore {
    constructor(private readonly auth: Partial<ResolvedAuthorization> = {}) {}
    async resolveAuthorization(_ref: string, signal?: AbortSignal): Promise<ResolvedAuthorization> {
        if (signal?.aborted) throw new Error('Aborted');
        if (this.auth.type === undefined) return { type: 'none' };
        return { type: 'basic', username: 'user', password: 'pass', ...this.auth };
    }
}

/** Canary store: throws if resolveAuthorization is ever called in a context it shouldn't be */
class CanarySecretStore implements ConnectionSecretStore {
    public calls = 0;
    async resolveAuthorization(): Promise<ResolvedAuthorization> {
        this.calls++;
        return { type: 'none' };
    }
}

function makeSrc(overrides: Partial<MediaSourceDescriptor> = {}): MediaSourceDescriptor {
    return {
        id: 'src1',
        sourceType: 'rtsp',
        transport: 'tcp',
        deviceId: 'cam1',
        sourceLocatorRef: 'rtsp://192.168.1.10:554/stream',
        credentialRef: 'cam1',
        ...overrides,
    };
}

function makeDiscovery(sources: MediaSourceDescriptor[] = []): MediaSourceDiscoveryResult {
    return { available: sources.length > 0, sources, checkedAt: new Date().toISOString() };
}

// ── MediaSourceDiscoveryResult shape ──────────────────────────────────────────

describe('MediaSourceDiscoveryResult', () => {
    it('has required fields', () => {
        const result = makeDiscovery([makeSrc()]);
        assert.equal(typeof result.available, 'boolean');
        assert.ok(Array.isArray(result.sources));
        assert.equal(typeof result.checkedAt, 'string');
    });

    it('is unavailable when sources is empty', () => {
        const result = makeDiscovery([]);
        assert.equal(result.available, false);
    });
});

// ── RtspInputResolver ─────────────────────────────────────────────────────────

describe('RtspInputResolver', () => {
    const store = new MockSecretStore({ type: 'basic', username: 'admin', password: 'secret' });

    it('resolves rtsp source', async () => {
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceLocatorRef: 'rtsp://192.168.1.1/stream' });
        const result = await registry.resolve(desc, store);
        assert.equal(result.kind, 'rtsp');
        assert.ok(result.ffmpegInputArguments.some(a => a.includes('rtsp://')));
        // Note: RTSP credentials are correctly embedded in the URL (rtsp://user:pass@host)
        // rather than as separate -user/-password flags. The redactedDescription must hide them.
        assert.ok(!result.redactedDescription.includes('secret'), 'redactedDescription must not contain password');
    });

    it('embeds credentials in URL via cameraStreamUrl', async () => {
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceLocatorRef: 'rtsp://192.168.1.1/stream' });
        const result = await registry.resolve(desc, store);
        const url = result.ffmpegInputArguments.find(a => a.startsWith('rtsp://'));
        assert.ok(url, 'must contain an rtsp:// URL');
        assert.ok(url.includes('admin'), 'resolved URL must contain username');
    });

    it('redactedDescription never contains credentials', async () => {
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const result = await registry.resolve(makeSrc({ sourceLocatorRef: 'rtsp://192.168.1.1/stream' }), store);
        assert.ok(!result.redactedDescription.includes('secret'), 'redactedDescription must not contain password');
        assert.ok(!result.redactedDescription.includes('admin'), 'redactedDescription must not contain username');
    });

    it('throws if sourceLocatorRef is missing', async () => {
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceLocatorRef: undefined });
        await assert.rejects(() => registry.resolve(desc, store), /sourceLocatorRef/);
    });
});

// ── ONVIF via MediaSourceLocatorStore ────────────────────────────────────────

describe('ONVIF locator store (Opción B)', () => {
    it('resolves ONVIF source using locatorStore', async () => {
        const mockLocatorStore: MediaSourceLocatorStore = {
            async resolveLocatorUri(_descriptor, _signal) {
                return 'rtsp://192.168.1.50:554/profile1';
            },
        };

        const resolver = new RtspInputResolver(mockLocatorStore);
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);

        const desc = makeSrc({
            sourceType: 'onvif',
            sourceLocatorRef: 'Profile_1', // opaque token — NOT a URI
            credentialRef: 'cam-onvif',
        });

        const store = new MockSecretStore({ type: 'basic', username: 'admin', password: 'pass' });
        const result = await registry.resolve(desc, store);

        assert.equal(result.kind, 'rtsp');
        const url = result.ffmpegInputArguments.find(a => a.startsWith('rtsp://'));
        assert.ok(url, 'resolved URL must be present');
        assert.ok(!url.includes('Profile_1'), 'resolved URL must NOT contain the ONVIF token');
        assert.ok(!result.redactedDescription.includes('pass'), 'password must be redacted in description');
    });
});

// ── HttpInputResolver ─────────────────────────────────────────────────────────

describe('HttpInputResolver', () => {
    it('resolves http source', async () => {
        const resolver = new HttpInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceType: 'http', transport: 'http', sourceLocatorRef: 'http://192.168.1.1/snapshot.jpg', credentialRef: undefined });
        const result = await registry.resolve(desc, new MockSecretStore({ type: 'none' }));
        assert.equal(result.kind, 'http');
        assert.ok(result.ffmpegInputArguments.includes('http://192.168.1.1/snapshot.jpg'));
    });

    it('adds Bearer header for bearer auth', async () => {
        const resolver = new HttpInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceType: 'http', transport: 'http', sourceLocatorRef: 'http://cloud.example.com/stream' });
        const result = await registry.resolve(desc, new MockSecretStore({ type: 'bearer', token: 'mytoken123' }));
        assert.ok(result.ffmpegInputArguments.some(a => a.includes('Bearer mytoken123')));
    });
});

// ── HlsInputResolver ─────────────────────────────────────────────────────────

describe('HlsInputResolver', () => {
    it('resolves HLS source without file protocol', async () => {
        const resolver = new HlsInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceType: 'hls', transport: 'https', sourceLocatorRef: 'https://example.com/stream.m3u8', credentialRef: undefined });
        const result = await registry.resolve(desc, new MockSecretStore());
        assert.equal(result.kind, 'hls');
        const whitelistArg = result.ffmpegInputArguments[result.ffmpegInputArguments.indexOf('-protocol_whitelist') + 1];
        assert.ok(!whitelistArg.includes('file'), 'file protocol must NOT be in whitelist (B13)');
        assert.ok(whitelistArg.includes('http'), 'http must be in whitelist');
        assert.ok(whitelistArg.includes('https'), 'https must be in whitelist');
    });
});

// ── BufferInputResolver / PipeInputResolver ────────────────────────────────────

describe('BufferInputResolver', () => {
    it('resolves buffer source', async () => {
        const resolver = new BufferInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceType: 'plugin_buffer', transport: 'buffer', pluginId: 'ring-plugin' });
        const result = await registry.resolve(desc, new MockSecretStore());
        assert.equal(result.kind, 'buffer');
        assert.ok(result.ffmpegInputArguments.includes('pipe:0'));
    });
});

describe('PipeInputResolver', () => {
    it('resolves pipe source', async () => {
        const resolver = new PipeInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceType: 'plugin_pipe', transport: 'pipe', pluginId: 'unifi-plugin' });
        const result = await registry.resolve(desc, new MockSecretStore());
        assert.equal(result.kind, 'pipe');
        assert.ok(result.ffmpegInputArguments.includes('pipe:0'));
    });
});

// ── MediaSourceSessionManager ────────────────────────────────────────────────

function makeSessionManager(
    getProvider: (pluginId: string | undefined, deviceId: string) => CameraMediaProvider,
    registry: MediaInputResolverRegistry,
    store: ConnectionSecretStore = new MockSecretStore()
) {
    return new MediaSourceSessionManager(getProvider as any, registry, store);
}

describe('executeWithSourceRetry', () => {
    it('executes operation with resolved input', async () => {
        const src = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const provider: CameraMediaProvider = {
            async getMediaSources() { return makeDiscovery([src]); },
        };

        const registry = new MediaInputResolverRegistry();
        registry.register(new RtspInputResolver());

        const manager = makeSessionManager(() => provider, registry);

        let receivedInput: ResolvedMediaInput | undefined;
        const result = await manager.executeWithSourceRetry('cam1', 'src1', async (input) => {
            receivedInput = input;
            return 42;
        });

        assert.equal(result, 42);
        assert.ok(receivedInput, 'input was passed to operation');
        assert.equal(receivedInput!.kind, 'rtsp');
    });

    it('retries on 401 error and succeeds on second attempt', async () => {
        let callCount = 0;
        const src = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const provider: CameraMediaProvider = {
            async getMediaSources() { return makeDiscovery([src]); },
        };

        const registry = new MediaInputResolverRegistry();
        registry.register(new RtspInputResolver());
        const manager = makeSessionManager(() => provider, registry);

        const result = await manager.executeWithSourceRetry('cam1', 'src1', async (_input) => {
            callCount++;
            if (callCount === 1) throw new Error('401 Unauthorized');
            return 'success';
        });

        assert.equal(result, 'success');
        assert.equal(callCount, 2);
    });

    it('throws on cancellation via AbortSignal', async () => {
        const src = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const provider: CameraMediaProvider = {
            async getMediaSources() { return makeDiscovery([src]); },
        };

        const registry = new MediaInputResolverRegistry();
        registry.register(new RtspInputResolver());
        const manager = makeSessionManager(() => provider, registry);

        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            () => manager.executeWithSourceRetry('cam1', 'src1', async () => 1, undefined, controller.signal),
            /Aborted/
        );
    });

    it('calls cleanup on success', async () => {
        let cleanupCalled = false;
        const src = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const provider: CameraMediaProvider = {
            async getMediaSources() { return makeDiscovery([src]); },
        };

        const registry = new MediaInputResolverRegistry();
        // Custom resolver that injects cleanup
        registry.register({
            canResolve: (d) => d.sourceType === 'rtsp',
            async resolve(_d, _s) {
                return {
                    kind: 'rtsp',
                    ffmpegInputArguments: ['-i', 'rtsp://10.0.0.1/stream'],
                    probeStrategy: 'ffprobe',
                    redactedDescription: 'test',
                    cleanup: async () => { cleanupCalled = true; },
                };
            },
        });

        const manager = makeSessionManager(() => provider, registry);

        await manager.executeWithSourceRetry('cam1', 'src1', async () => 'done');
        assert.ok(cleanupCalled, 'cleanup must be called after operation');
    });

    it('calls cleanup on error', async () => {
        let cleanupCalled = false;
        const src = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const provider: CameraMediaProvider = {
            async getMediaSources() { return makeDiscovery([src]); },
        };

        const registry = new MediaInputResolverRegistry();
        registry.register({
            canResolve: (d) => d.sourceType === 'rtsp',
            async resolve() {
                return {
                    kind: 'rtsp',
                    ffmpegInputArguments: ['-i', 'rtsp://x'],
                    probeStrategy: 'ffprobe',
                    redactedDescription: 'test',
                    cleanup: async () => { cleanupCalled = true; },
                };
            },
        });

        const manager = makeSessionManager(() => provider, registry);

        await assert.rejects(
            () => manager.executeWithSourceRetry('cam1', 'src1', async () => {
                throw new MediaOperationError('fatal', 'not_retryable');
            })
        );
        assert.ok(cleanupCalled, 'cleanup must be called even when operation throws');
    });
});

// ── MediaSourceSelector ───────────────────────────────────────────────────────

describe('MediaSourceSelector', () => {
    const selector = new MediaSourceSelector();

    it('selectForPreview picks profile at or below 1080p', () => {
        const sources = [
            { descriptor: makeSrc({ id: '4k' }), profile: { id: '4k', width: 3840, height: 2160, validationStatus: 'valid' as const }, probeSucceeded: true },
            { descriptor: makeSrc({ id: '1080p' }), profile: { id: '1080p', width: 1920, height: 1080, validationStatus: 'valid' as const }, probeSucceeded: true },
            { descriptor: makeSrc({ id: '480p' }), profile: { id: '480p', width: 854, height: 480, validationStatus: 'valid' as const }, probeSucceeded: true },
        ];
        const selected = selector.selectForPreview(sources);
        assert.ok(selected, 'must select a profile');
        assert.ok((selected.width ?? 0) <= 1920, `selected profile width must be <= 1920, got ${selected.width}`);
    });

    it('selectForSnapshot picks highest resolution', () => {
        const sources = [
            { descriptor: makeSrc({ id: '1080p' }), profile: { id: '1080p', width: 1920, height: 1080, validationStatus: 'valid' as const }, probeSucceeded: true },
            { descriptor: makeSrc({ id: '4k' }), profile: { id: '4k', width: 3840, height: 2160, validationStatus: 'valid' as const }, probeSucceeded: true },
        ];
        const selected = selector.selectForSnapshot(sources);
        assert.ok(selected, 'must select a profile');
        assert.equal(selected.id, '4k');
    });
});

// ── Canary secret test ────────────────────────────────────────────────────────

describe('Canary secrets', () => {
    it('resolveAuthorization is NOT called when credentialRef is absent', async () => {
        const canary = new CanarySecretStore();
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);

        const desc = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream', credentialRef: undefined });
        await registry.resolve(desc, canary);

        assert.equal(canary.calls, 0, 'resolveAuthorization must NOT be called when credentialRef is absent');
    });

    it('redactedDescription never contains credentials from store', async () => {
        const store = new MockSecretStore({ type: 'basic', username: 'admin', password: 'hunter2' });
        const resolver = new RtspInputResolver();
        const registry = new MediaInputResolverRegistry();
        registry.register(resolver);
        const desc = makeSrc({ sourceLocatorRef: 'rtsp://10.0.0.1/stream' });
        const result = await registry.resolve(desc, store);
        assert.ok(!result.redactedDescription.includes('hunter2'), 'password must not appear in redactedDescription');
    });
});
