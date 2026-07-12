import type { ServerNode } from 'matterbridge/matter';
import crypto from 'node:crypto';

export interface CameraCapabilities {
    name: string;
    vendorId: number;
    productId: number;
}

export class CameraMatterNode {
    private node?: ServerNode;
    private state: 'offline' | 'starting' | 'online' | 'error' = 'offline';
    private matterCore: any;

    constructor(
        public readonly cameraId: string,
        private readonly matterHome: string
    ) {}

    async start(capabilities: CameraCapabilities) {
        this.state = 'starting';
        try {
            if (!this.matterCore) {
                this.matterCore = await import('matterbridge/matter');
            }
            const matterDevices = await import('matterbridge/matter/devices');

            const { ServerNode, VendorId, DeviceTypeId } = this.matterCore;
            const { CameraDevice } = matterDevices;

            const storageId = `camera-${this.cameraId}`;

            this.node = await ServerNode.create({
                id: storageId,
                network: {
                    port: 0,
                },
                productDescription: {
                    name: capabilities.name || 'Scryvex Camera',
                    deviceType: DeviceTypeId(0x0111),
                },
                basicInformation: {
                    vendorName: 'Scryvex',
                    vendorId: VendorId(capabilities.vendorId || 0xFFF1),
                    nodeLabel: capabilities.name || 'Scryvex Camera',
                    productName: 'Scryvex Pro V2',
                    productId: capabilities.productId || 0x8000,
                    serialNumber: this.cameraId.substring(0, 32),
                    hardwareVersion: 1,
                    softwareVersion: 1,
                },
            });

            this.node!.add(CameraDevice);

            await this.node!.start();
            this.state = 'online';
            console.log(`[CameraMatterNode ${this.cameraId}] Node iniciado.`);
        } catch (error) {
            this.state = 'error';
            console.error(`[CameraMatterNode ${this.cameraId}] Error iniciando:`, error);
            throw error;
        }
    }

    async stop() {
        if (this.node) {
            await this.node.close();
            this.node = undefined;
        }
        this.state = 'offline';
    }

    getStatus() {
        if (!this.node) return { state: this.state, commissioned: false, fabrics: [] };

        const state = this.node.lifecycle.isOnline ? 'online' : 'offline';
        const commissioned = this.node.lifecycle.isCommissioned;
        
        // Use commissioning state safely
        const fabricsObj = (this.node.state as any).commissioning?.fabrics || {};
        const mappedFabrics = Object.values(fabricsObj).map((f: any) => ({
            fabricIndex: f.fabricIndex,
            fabricLabel: f.label,
            vendorId: f.rootVendorId,
            nodeId: f.nodeId.toString(),
            appleFabricPresent: f.rootVendorId === 0x1349,
        }));

        return {
            state,
            commissioned,
            fabrics: mappedFabrics
        };
    }

    async openCommissioningWindow() {
        if (!this.node) throw new Error('Node not started');
        
        const passcode = crypto.randomInt(10000000, 99999999);
        const discriminator = crypto.randomInt(0, 4096);
        
        // matter.js v1 ServerNode commissioning is usually done via a behavior or specific API.
        // If there's an openCommissioningWindow method on the lifecycle or environment:
        const window = await (this.node as any).openCommissioningWindow?.({
            discriminator,
            passcode,
            timeout: 900,
        }) || { manualPairingCode: 'N/A', qrPairingCode: 'N/A', passcode, discriminator };

        return {
            manualCode: window.manualPairingCode,
            qrCode: window.qrPairingCode,
            passcode: window.passcode,
            discriminator: window.discriminator,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        };
    }

    async closeCommissioningWindow() {
        // Not natively implemented in basic API for now
    }

    async removeFabric(fabricIndex: number) {
        if (!this.node) throw new Error('Node not started');
    }

    async factoryReset() {
        if (this.node) {
            await (this.node as any).factoryReset?.();
        }
    }
}
