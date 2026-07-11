export interface NormalizedSetting {
    pluginId: string;
    deviceId: string;
    key: string;
    title: string;
    description?: string;
    type: 'boolean' | 'number' | 'string' | 'password' | 'button' | 'device' | 'interface' | 'select' | 'unknown';
    originalType?: string; // when type is 'unknown'
    value?: string | number | boolean | null;
    secret?: boolean;
    configured?: boolean;
    choices?: string[];
    group: string;
    subgroup?: string;
    advanced: boolean;
    hidden: boolean;
    readOnly: boolean;
    restartRequired: boolean;
    placeholder?: string;
    range?: [number, number];
    multiple?: boolean;
    combobox?: boolean;
    deviceFilter?: string;
    source: 'scrypted' | 'apple-overlay' | 'matter-overlay' | 'scryvex';
    classification: 'original' | 'recommended' | 'apple_improved' | 'deprecated' | 'automatic' | 'unsupported' | 'diagnostic';
}

export interface NormalizedMediaOption {
    id: string;
    name?: string;
    container?: string;
    videoCodec?: string;
    audioCodec?: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    source?: string;
    purpose?: string;
}

export interface DeviceReadError {
    source: 'identity' | 'interfaces' | 'settings' | 'media' | 'capabilities';
    code: string;
    message: string;
    occurredAt: string;
}

export interface RawSettingSnapshot {
    key: string;
    title?: string;
    description?: string;
    type: string;
    value?: unknown;
    choices?: string[];
    group?: string;
    subgroup?: string;
    advanced?: boolean;
    hidden?: boolean;
    readonly?: boolean;
    restartRequired?: boolean;
    placeholder?: string;
    range?: [number, number];
    multiple?: boolean;
    combobox?: boolean;
    deviceFilter?: string;
}

export interface RawMediaOptionSnapshot {
    id: string;
    name?: string;
    video?: {
        codec?: string;
    };
    audio?: {
        codec?: string;
    };
    container?: string;
    width?: number;
    height?: number;
    fps?: number;
    bitrate?: number;
    source?: string;
    purpose?: string;
}

export interface RawDeviceSnapshot {
    id: string;
    pluginId: string;
    name: string;
    type?: string;
    manufacturer?: string;
    model?: string;
    interfaces: readonly string[];
    settings: readonly RawSettingSnapshot[];
    mediaOptions: readonly RawMediaOptionSnapshot[];
    readErrors: readonly DeviceReadError[];
}

export interface DeviceDiagnostics {
    status: 'not_evaluated' | 'healthy' | 'warning' | 'critical' | 'offline';
    lastChecked?: string;
}

export interface DeviceModelView {
    id: string;
    revision: string;
    generatedAt: string;
    plugin: string;
    name: string;
    manufacturer: string;
    model: string;
    interfaces: string[];
    capabilities: string[];
    settings: NormalizedSetting[];
    media: {
        options: NormalizedMediaOption[];
    };
    diagnostics: DeviceDiagnostics;
}

// Temporary exports while we don't have entities fully typed
export interface DeviceEntity {}
