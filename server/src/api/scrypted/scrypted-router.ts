import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { CoreServiceFacade } from '../../core/CoreServiceFacade';

export function createScryptedRouter(
    pool: Pool,
    scryptedRuntime: any 
): Router {
    const router = Router();
    const coreService = new CoreServiceFacade(scryptedRuntime);

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
            const devices = await coreService.listDevices();
            res.json({ devices });
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

    return router;
}
