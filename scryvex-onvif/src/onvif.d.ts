declare module 'onvif' {
    export class Cam {
        constructor(options: Record<string, unknown>, callback: (error: Error, camera: Cam) => void);
        getProfiles(callback: (error: Error | null, profiles: unknown[]) => void): void;
        getStreamUri(options: Record<string, unknown>, callback: (error: Error | null, stream: unknown) => void): void;
    }
}
