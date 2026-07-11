import { MediaSourceDescriptor, CameraMediaProvider, MediaOperationError } from './media-source';
import { ResolvedMediaInput, MediaInputResolverRegistry } from './media-resolvers';
import { ConnectionSecretStore } from './credential-store';

export class MediaSourceSessionManager {
    private activeSessions = new Map<string, { descriptor: MediaSourceDescriptor, expiresAt: number }>();
    private refreshPromises = new Map<string, Promise<MediaSourceDescriptor>>();

    constructor(
        private providerLookup: (pluginId: string | undefined, deviceId: string) => CameraMediaProvider | Promise<CameraMediaProvider>,
        private registry: MediaInputResolverRegistry,
        private secretStore: ConnectionSecretStore
    ) {}

    /**
     * Executes a media operation with automatic retries for 401/403 errors and expired sources.
     * Supports only idempotent operations.
     */
    async executeWithSourceRetry<T>(
        deviceId: string, 
        sourceId: string, 
        operation: (input: ResolvedMediaInput, signal?: AbortSignal) => Promise<T>,
        pluginId?: string,
        signal?: AbortSignal
    ): Promise<T> {
        let attempt = 0;
        const maxAttempts = 2; // Initial attempt + 1 retry
        
        while (attempt < maxAttempts) {
            attempt++;
            
            if (signal?.aborted) throw new MediaOperationError('Aborted by signal', 'cancelled');
            
            let descriptor = await this.getValidDescriptor(deviceId, sourceId, pluginId, signal);
            let input: ResolvedMediaInput | undefined;
            
            try {
                input = await this.registry.resolve(descriptor, this.secretStore, signal);
                return await operation(input, signal);
            } catch (e: any) {
                // Determine if error is retryable auth/expiration error
                const isRetryableAuthError = 
                    e instanceof MediaOperationError && 
                    (e.category === 'authentication_failed' || e.category === 'expired_source');

                if (isRetryableAuthError && attempt < maxAttempts) {
                    console.log(`[SessionManager] Retryable auth error on ${deviceId}/${sourceId}. Forcing refresh (Attempt ${attempt})...`);
                    this.invalidateSession(deviceId, sourceId);
                    // The next loop iteration will call getValidDescriptor which will trigger a forceRefresh
                    continue;
                }
                throw e;
            } finally {
                // Ensure cleanup is ALWAYS called exactly once per resolved input
                if (input && typeof input.cleanup === 'function') {
                    await input.cleanup().catch(err => {
                        console.error(`[SessionManager] Cleanup failed for ${deviceId}/${sourceId}:`, err);
                    });
                }
            }
        }
        
        throw new MediaOperationError('Max retries exceeded', 'not_retryable');
    }

    private invalidateSession(deviceId: string, sourceId: string) {
        this.activeSessions.delete(`${deviceId}:${sourceId}`);
    }

    private async getValidDescriptor(
        deviceId: string, 
        sourceId: string, 
        pluginId?: string,
        signal?: AbortSignal
    ): Promise<MediaSourceDescriptor> {
        const sessionKey = `${deviceId}:${sourceId}`;
        const session = this.activeSessions.get(sessionKey);

        if (session && session.expiresAt > Date.now() + 30000) {
            return session.descriptor;
        }

        return this.forceRefresh(deviceId, sourceId, pluginId, signal);
    }

    private async forceRefresh(
        deviceId: string, 
        sourceId: string, 
        pluginId?: string,
        signal?: AbortSignal
    ): Promise<MediaSourceDescriptor> {
        const sessionKey = `${deviceId}:${sourceId}`;
        
        if (this.refreshPromises.has(sessionKey)) {
            return this.refreshPromises.get(sessionKey)!;
        }

        const promise = (async () => {
            const provider = await Promise.resolve(this.providerLookup(pluginId, deviceId));
            if (!provider.refreshMediaSource) {
                // Fallback to getMediaSources
                const discovery = await provider.getMediaSources(deviceId, signal);
                const source = discovery.sources.find(s => s.id === sourceId);
                if (!source) throw new MediaOperationError('Source not found after refresh', 'not_retryable');
                return source;
            }
            return await provider.refreshMediaSource(deviceId, sourceId, signal);
        })();

        this.refreshPromises.set(sessionKey, promise);

        try {
            const newDescriptor = await promise;
            this.activeSessions.set(sessionKey, {
                descriptor: newDescriptor,
                expiresAt: newDescriptor.expirationMs || (Date.now() + 24 * 60 * 60 * 1000)
            });
            return newDescriptor;
        } finally {
            this.refreshPromises.delete(sessionKey);
        }
    }
}
