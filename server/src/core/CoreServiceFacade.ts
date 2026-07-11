import { PluginRepository } from './PluginRepository';
import { DeviceModelFactory } from './DeviceModelFactory';
import { DeviceRepository } from './DeviceRepository';
import { DeviceModel } from './DeviceModel';

/**
 * CoreServiceFacade
 * Es el único punto de entrada de la capa de API (Express/WS) y la UI (React).
 * Mantiene la orquestación de la plataforma sobre Scrypted.
 */
export class CoreServiceFacade {
    private pluginRepo: PluginRepository;
    private deviceFactory: DeviceModelFactory;
    private deviceRepo: DeviceRepository;

    constructor(runtime: any) {
        this.pluginRepo = new PluginRepository(runtime);
        this.deviceFactory = new DeviceModelFactory(this.pluginRepo);
        this.deviceRepo = new DeviceRepository(this.pluginRepo, this.deviceFactory);
    }

    async listPlugins(): Promise<string[]> {
        return this.pluginRepo.getRawPlugins();
    }

    async listDevices(): Promise<DeviceModel[]> {
        return await this.deviceRepo.listDevices();
    }

    async getDevice(id: string): Promise<DeviceModel | undefined> {
        return await this.deviceRepo.getDevice(id);
    }
}
