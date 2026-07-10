import { CameraService } from '../api/camera-service';

export type ResolvedAuthorizationType = 'basic' | 'bearer' | 'headers' | 'signed_url' | 'none';

export interface ResolvedAuthorization {
    type: ResolvedAuthorizationType;
    username?: string;
    password?: string;
    token?: string;
    headers?: Record<string, string>;
    signedUrl?: string;
}

export interface ConnectionSecretStore {
    resolveAuthorization(ref: string, signal?: AbortSignal): Promise<ResolvedAuthorization>;
}

/**
 * Resolves camera credentials from the database.
 * Wraps CameraService.getConnectionInput() which currently stores password_hash as the raw secret.
 * A proper encryption migration would be handled separately.
 */
export class DatabaseConnectionSecretStore implements ConnectionSecretStore {
    constructor(private readonly cameraService: CameraService) {}

    async resolveAuthorization(ref: string, signal?: AbortSignal): Promise<ResolvedAuthorization> {
        if (signal?.aborted) throw new Error('Aborted');

        const connection = await this.cameraService.getConnectionInput(ref);
        if (!connection) {
            return { type: 'none' };
        }

        if (connection.username || connection.password) {
            return {
                type: 'basic',
                username: connection.username,
                password: connection.password,
            };
        }

        return { type: 'none' };
    }
}
