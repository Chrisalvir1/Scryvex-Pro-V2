import { DeviceModel } from './DeviceModel';
import { PluginRepository } from './PluginRepository';
import { DeviceModelFactory } from './DeviceModelFactory';

export class DeviceRepository {
    // In a full implementation, this could hold a cached projection, but for now we generate on demand
    // to guarantee the model is a projection of the current runtime state.
    constructor(
        private readonly pluginRepo: PluginRepository,
        private readonly factory: DeviceModelFactory
    ) {}

    async listDevices(): Promise<DeviceModel[]> {
        const rawDevices = this.pluginRepo.getRawDevices();
        const models: DeviceModel[] = [];
        for (const raw of rawDevices) {
            models.push(await this.factory.buildFromRaw(raw));
        }
        return models;
    }

    async getDevice(id: string): Promise<DeviceModel | undefined> {
        const raw = this.pluginRepo.getRawDevice(id);
        if (!raw) return undefined;
        return await this.factory.buildFromRaw(raw);
    }
}
