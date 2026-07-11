import { Router, Request, Response } from 'express';
import { CoreServiceFacade } from '../../core/CoreServiceFacade';

export function createScryptedRouter(coreService: CoreServiceFacade): Router {
    const router = Router();

    // ── Plugins ──────────────────────────────────────────────────────────────
    router.get('/plugins', async (_req: Request, res: Response) => {
        try {
            const plugins = await coreService.listPlugins();
            res.json({ plugins });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to fetch plugins', detail: err.message });
        }
    });

    // ── Devices (DeviceModel Projection) ──────────────────────────────────────
    router.get('/devices', async (_req: Request, res: Response) => {
        try {
            const { devices, errors } = await coreService.listDevices();
            res.json({ devices, errors });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to fetch devices', detail: err.message });
        }
    });

    router.get('/devices/:id', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }
            res.json({ device });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to fetch device', detail: err.message });
        }
    });

    router.get('/devices/:id/interfaces', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ interfaces: device.interfaces });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed', detail: err.message });
        }
    });

    router.get('/devices/:id/settings', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ settings: device.settings });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed', detail: err.message });
        }
    });

    router.get('/devices/:id/media-options', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ mediaOptions: device.media.options });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed', detail: err.message });
        }
    });

    router.get('/devices/:id/capabilities', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ capabilities: device.capabilities });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed', detail: err.message });
        }
    });

    router.get('/devices/:id/diagnostics', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ diagnostics: device.diagnostics });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed', detail: err.message });
        }
    });

    return router;
}
