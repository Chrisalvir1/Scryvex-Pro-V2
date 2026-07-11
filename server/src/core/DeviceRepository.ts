import type { DeviceModelView } from '@scryvex/contracts';
import { PluginRepository } from './PluginRepository';
import { DeviceModelFactory } from './DeviceModelFactory';

interface CacheEntry {
    model: DeviceModelView;
    timestamp: number;
}

export class DeviceRepository {
    private cache = new Map<string, CacheEntry>();
    private pendingFetches = new Map<string, Promise<DeviceModelView | undefined>>();
    private readonly TTL_MS = 2000; // 2 seconds TTL

    constructor(
        private readonly pluginRepo: PluginRepository,
        private readonly factory: DeviceModelFactory
    ) {}

    async listDevices(): Promise<{ devices: DeviceModelView[], errors: any[] }> {
        const ids = this.pluginRepo.getDeviceIds();
        
        const results = await Promise.allSettled(
            ids.map(id => this.getDeviceModel(id))
        );

        const models: DeviceModelView[] = [];
        const errors: any[] = [];

        results.forEach((res, index) => {
            if (res.status === 'fulfilled' && res.value) {
                models.push(res.value);
            } else if (res.status === 'rejected') {
                errors.push({
                    deviceId: ids[index],
                    code: 'DEVICE_SNAPSHOT_FAILED',
                    message: res.reason?.message || 'Unknown error'
                });
            }
        });

        return { devices: models, errors };
    }

    async getDeviceModel(id: string, forceRefetch: boolean = false): Promise<DeviceModelView | undefined> {
        if (!forceRefetch) {
            const cached = this.cache.get(id);
            if (cached && (Date.now() - cached.timestamp < this.TTL_MS)) {
                return cached.model;
            }
        }

        // Single-flight: si ya hay una petición en vuelo, nos colgamos de ella.
        let pending = this.pendingFetches.get(id);
        if (pending) {
            return pending;
        }

        pending = this.fetchAndBuild(id).finally(() => {
            this.pendingFetches.delete(id);
        });

        this.pendingFetches.set(id, pending);
        return pending;
    }

    private async fetchAndBuild(id: string): Promise<DeviceModelView | undefined> {
        const snapshot = await this.pluginRepo.getRawSnapshot(id);
        if (!snapshot) return undefined;
        
        const model = this.factory.buildFromSnapshot(snapshot);
        this.cache.set(id, { model, timestamp: Date.now() });
        return model;
    }
}
