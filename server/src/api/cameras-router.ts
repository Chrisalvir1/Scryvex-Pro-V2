import { Router, Request, Response } from 'express';
import { CameraService, CreateCameraInput } from './camera-service';

/**
 * Mounts REST endpoints for camera CRUD under /api/cameras.
 * All routes require the user to be authenticated (handled by parent app middleware).
 */
export function createCamerasRouter(cameraService: CameraService): Router {
    const router = Router();

    // GET /api/cameras — list all cameras (no passwords returned)
    router.get('/', async (_req: Request, res: Response) => {
        try {
            const cameras = await cameraService.findAll();
            res.json({ cameras });
        } catch (err: any) {
            console.error('[cameras-router] GET /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to fetch cameras', detail: err.message });
        }
    });

    // GET /api/cameras/:id/events — recent events for a camera
    router.get('/:id/events', async (req: Request, res: Response) => {
        try {
            const id    = String(req.params['id']);
            const raw   = req.query['limit'];
            const limit = Math.min(parseInt(Array.isArray(raw) ? String(raw[0]) : (raw as string) ?? '50'), 200);
            const events = await cameraService.getRecentEvents(id, limit);
            res.json({ events });
        } catch (err: any) {
            console.error('[cameras-router] GET events error:', err.message);
            res.status(500).json({ error: 'Failed to fetch events', detail: err.message });
        }
    });

    // POST /api/cameras — add a new camera
    router.post('/', async (req: Request, res: Response) => {
        try {
            const body = req.body as CreateCameraInput;

            // Validate required fields
            if (!body.name || !body.ip || !body.port || !body.protocol) {
                res.status(400).json({
                    error: 'Missing required fields: name, ip, port, protocol',
                });
                return;
            }

            // Validate protocol
            if (!['RTSP', 'ONVIF'].includes(body.protocol)) {
                res.status(400).json({ error: 'protocol must be RTSP or ONVIF' });
                return;
            }

            // Validate RTSP URL format if provided
            if (body.rtsp_url && !body.rtsp_url.startsWith('rtsp://')) {
                res.status(400).json({ error: 'rtsp_url must start with rtsp://' });
                return;
            }

            const camera = await cameraService.create(body);
            res.status(201).json({ camera });
        } catch (err: any) {
            console.error('[cameras-router] POST /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to create camera', detail: err.message });
        }
    });

    // DELETE /api/cameras/:id — remove a camera and its events (CASCADE)
    router.delete('/:id', async (req: Request, res: Response) => {
        try {
            const id      = String(req.params['id']);
            const deleted = await cameraService.delete(id);
            if (!deleted) {
                res.status(404).json({ error: 'Camera not found' });
                return;
            }
            res.json({ success: true, id });
        } catch (err: any) {
            console.error('[cameras-router] DELETE /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to delete camera', detail: err.message });
        }
    });

    return router;
}
