import type { DeviceModelView } from '@scryvex/contracts';
import { PluginRepository } from './PluginRepository';
import { DeviceRepository } from './DeviceRepository';

/**
 * CoreServiceFacade
 * Es el único punto de entrada de la capa de API (Express/WS) y la UI (React).
 * Mantiene la orquestación de la plataforma sobre Scrypted.
 */
export class CoreServiceFacade {
    constructor(
        private readonly pluginRepo: PluginRepository,
        private readonly deviceRepo: DeviceRepository
    ) {}

    async listPlugins(): Promise<string[]> {
        return this.pluginRepo.getRawPlugins();
    }

    async listDevices(): Promise<{ devices: DeviceModelView[], errors: any[] }> {
        return await this.deviceRepo.listDevices();
    }

    async getDevice(id: string): Promise<DeviceModelView | undefined> {
        return await this.deviceRepo.getDeviceModel(id);
    }
}
