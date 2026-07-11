import { MediaSourceDescriptor } from './media-source';

/**
 * Opaque URI resolver — Adapters implement this to reconstruct the
 * stream URI from a descriptor that contains only a non-secret reference
 * (e.g. an ONVIF profile token), never a raw URI with credentials.
 *
 * Credentials are added separately by the ConnectionSecretStore /
 * RtspInputResolver after this call returns.
 */
export interface MediaSourceLocatorStore {
    /**
     * Returns the base stream URI **without credentials** for the given
     * descriptor.  Only the scheme, host, port, and path are included.
     * The caller (RtspInputResolver) will embed credentials via
     * cameraStreamUrl().
     *
     * Implementations must NOT embed username/password in the returned URI.
     */
    resolveLocatorUri(
        descriptor: MediaSourceDescriptor,
        signal?: AbortSignal
    ): Promise<string>;
}
