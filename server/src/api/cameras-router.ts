import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { CameraService, CreateCameraInput } from './camera-service';
import { CameraStreamController } from './camera-stream-controller';
import { CameraProbe } from './camera-probe';
import { MatterPairingService } from './matter-pairing';

const streamController = new CameraStreamController();

/**
 * Mounts REST endpoints for camera CRUD under /api/cameras.
 * All routes require the user to be authenticated (handled by parent app middleware).
 */
export function createCamerasRouter(cameraService: CameraService, pool: Pool): Router {
    const router = Router();
    const probeService = new CameraProbe(pool);
    const matterService = new MatterPairingService(pool);

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

    // ── Stream Controls ────────────────────────────────────────────────────────

    router.post('/:id/stream/start', async (req, res) => {
        try {
            await streamController.startStream(req.params.id);
            res.json({ success: true, message: 'Stream started' });
        } catch (err: any) {
            console.error('[cameras-router] Start stream error:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/:id/stream/stop', (req, res) => {
        streamController.stopStream(req.params.id);
        res.json({ success: true, message: 'Stream stopped' });
    });

    // ── Codec Probe / Analytics ────────────────────────────────────────────────

    router.get('/:id/probe', async (req, res) => {
        try {
            // In a real flow, if data doesn't exist, we run it
            let data = await probeService.getProbeData(req.params.id);
            if (!data) {
                data = await probeService.runProbe(req.params.id);
            }
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/:id/probe/hevc', async (req, res) => {
        try {
            const data = await probeService.toggleHEVC(req.params.id, req.body.enabled);
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Matter Integration Endpoint ────────────────────────────────────────────

    router.get('/:id/matter/pairing', async (req, res) => {
        try {
            const data = await matterService.generateCommissioningWindow(req.params.id);
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/:id/matter/status', async (req, res) => {
        try {
            const data = await matterService.getPairingStatus(req.params.id);
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.delete('/:id/matter/unpair', async (req, res) => {
        try {
            const data = await matterService.unpair(req.params.id);
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // GET /api/cameras/matter/devices — dedicated endpoint for Matterbridge to consume
    router.get('/matter/devices', async (req: Request, res: Response) => {
        try {
            const cameras = await cameraService.findAll();
            
            // Format cameras strictly matching the Matter object model
            const matterDevices = cameras.map(cam => ({
                id: cam.id,
                deviceType: 'VideoCamera',
                name: cam.matter_device_name || cam.name,
                vendorId: cam.matter_vendor_id || 4939,
                productId: cam.matter_product_id || 2049,
                endpoints: {
                    video: {
                        codecs: cam.hksv_codecs || ['H264'],
                        resolutions: cam.hksv_video_tiers || {},
                        rtsp_url: cam.rtsp_url
                    },
                    audio: {
                        codec: cam.hksv_audio_codec || 'Opus',
                        samplerate: cam.hksv_audio_samplerate || 16
                    },
                    networking: {
                        ipv4Address: cam.ip,
                        port: cam.port,
                        forceIpv4: true // Ensures Matter handles Ethernet or Wi-Fi identically via IPv4
                    }
                },
                capabilities: cam.hksv_capabilities || {},
                status: cam.status
            }));

            res.json({ devices: matterDevices });
        } catch (err: any) {
            console.error('[cameras-router] GET /api/cameras/matter/devices error:', err.message);
            res.status(500).json({ error: 'Failed to fetch Matter devices' });
        }
    });

    // ── YOLOv10 Endpoint ──────────────────────────────────────────────────────

    router.put('/:id/yolo', async (req: Request, res: Response) => {
        try {
            const { enabled } = req.body;
            const cameraId = req.params.id;
            // Update the jsonb config object in postgres to toggle YOLOv10
            await pool.query(
                `UPDATE scryvex_core.cameras 
                 SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{yolo_enabled}', $1::jsonb) 
                 WHERE id = $2`,
                [enabled ? 'true' : 'false', cameraId]
            );
            res.json({ success: true, enabled });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
