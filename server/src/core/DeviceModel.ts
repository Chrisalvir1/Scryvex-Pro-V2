export interface UiSetting {
    pluginId: string;
    deviceId: string;
    key: string;
    title: string;
    description?: string;
    type: 'boolean' | 'number' | 'string' | 'password' | 'select' | 'multiselect' | 'button' | 'readonly' | 'device' | 'interface';
    value: unknown;
    choices?: Array<{ label: string; value: unknown }>;
    group: string;
    subgroup?: string;
    advanced: boolean;
    hidden: boolean;
    readOnly: boolean;
    restartRequired: boolean;
    secret?: boolean;
    configured?: boolean;
    source: 'scrypted' | 'apple-overlay' | 'matter-overlay' | 'scryvex';
    classification: 'original' | 'recommended' | 'apple_improved' | 'deprecated' | 'automatic' | 'unsupported' | 'diagnostic';
}

export interface DeviceModel {
    id: string;
    revision: number;
    generatedAt: Date;
    plugin: string;
    name: string;
    manufacturer: string;
    model: string;
    interfaces: string[];
    capabilities: string[];
    media: {
        options: any[]; // Normalization to be expanded in Iteration 4
    };
    settings: UiSetting[];
    entities: string[];
    diagnostics: any; // Health metrics
}
