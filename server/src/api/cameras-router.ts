import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { createConnection } from 'node:net';
import { CameraService, CreateCameraInput } from './camera-service';
import { CameraStreamController } from './camera-stream-controller';
import { CameraProbe } from './camera-probe';
import { PreviewService } from '../media/preview-service';
import { MatterPairingService } from './matter-pairing';
import { OnvifAdapter } from '../cameras/adapters/onvif-adapter';

// ── Utilities ─────────────────────────────────────────────────────────────────

function tcpPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
    return new Promise(resolve => {
        const socket = createConnection({ host, port });
        const finish = (open: boolean) => { socket.destroy(); resolve(open); };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
    });
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * B2: probeService, previewService and onvifAdapter are explicitly injected —
 * no app.locals access inside route handlers.
 */
export function createCamerasRouter(
    cameraService: CameraService,
    pool: Pool,
    getWsBridge: () => import('./cameras-ws').CamerasWebSocketBridge | undefined,
    services: {
        probeService: CameraProbe;
        previewService: PreviewService;
        onvifAdapter: OnvifAdapter;
    }
): Router {
    const { probeService, previewService, onvifAdapter } = services;
    const router = Router();
    const streamController = new CameraStreamController(cameraService);

    // ── Cameras CRUD ──────────────────────────────────────────────────────────

    router.get('/', async (_req: Request, res: Response) => {
        try {
            const cameras = await cameraService.findAll();
            res.json({ cameras });
        } catch (err: any) {
            console.error('[cameras-router] GET /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to fetch cameras', detail: err.message });
        }
    });

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

    router.post('/', async (req: Request, res: Response) => {
        try {
            const body = req.body as CreateCameraInput;

            if (!body.name || !body.ip || !body.port || !body.protocol) {
                res.status(400).json({ error: 'Missing required fields: name, ip, port, protocol' });
                return;
            }
            if (!['RTSP', 'ONVIF'].includes(body.protocol)) {
                res.status(400).json({ error: 'protocol must be RTSP or ONVIF' });
                return;
            }
            if (body.rtsp_url && !body.rtsp_url.startsWith('rtsp://')) {
                res.status(400).json({ error: 'rtsp_url must start with rtsp://' });
                return;
            }

            const camera = await cameraService.create(body);
            getWsBridge()?.broadcastCamerasUpdated('camera.created', camera.id);
            res.status(201).json({ camera });

            // Async probe — does not block response
            void probeService.runProbe(camera.id)
                .then(() => getWsBridge()?.broadcastCamerasUpdated('camera.updated', camera.id))
                .catch((error: any) => console.error('[cameras-router] async probe failed:', error.message));
        } catch (err: any) {
            console.error('[cameras-router] POST /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to create camera', detail: err.message });
        }
    });

    router.delete('/:id', async (req: Request, res: Response) => {
        try {
            const id      = String(req.params['id']);
            const deleted = await cameraService.delete(id);
            if (!deleted) {
                res.status(404).json({ error: 'Camera not found' });
                return;
            }
            getWsBridge()?.broadcastCamerasUpdated('camera.deleted', id);
            res.json({ success: true, id });
        } catch (err: any) {
            console.error('[cameras-router] DELETE /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to delete camera', detail: err.message });
        }
    });

    // ── B10: Restore /test-onvif-port — uses OnvifAdapter.testConnection ──────

    router.post('/test-onvif-port', async (req, res) => {
        try {
            const { host, port, username, password } = req.body as {
                host: string;
                port?: number;
                username?: string;
                password?: string;
            };

            if (!host) {
                res.status(400).json({ error: 'host is required' });
                return;
            }

            const portNum = Number(port ?? 80);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                res.status(400).json({ error: 'port must be a valid port number (1–65535)' });
                return;
            }

            const result = await onvifAdapter.testConnection(host, portNum, username, password);
            res.json(result);
        } catch (err: any) {
            res.status(502).json({ success: false, status: 'error', message: err.message });
        }
    });

    // ── Discovery / Probe ─────────────────────────────────────────────────────

    router.post('/:id/discover', async (req, res) => {
        try {
            const capabilities = await probeService.runProbe(String(req.params.id));
            getWsBridge()?.broadcastCamerasUpdated('camera.updated', String(req.params.id));
            res.json({ capabilities });
        } catch (err: any) {
            res.status(502).json({ error: err.message });
        }
    });

    router.get('/:id/capabilities', async (req, res) => {
        const camera = await cameraService.findById(req.params.id);
        if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
        res.json({
            capabilities: camera.capabilities,
            discovery_status: camera.discovery_status,
            last_error: camera.last_error,
        });
    });

    router.post('/:id/test-connection', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            const capabilities = await probeService.runProbe(camera.id);
            res.json({ success: capabilities.discoveryStatus === 'online', status: capabilities.discoveryStatus });
        } catch (err: any) {
            res.status(502).json({ success: false, status: 'error', error: err.message });
        }
    });

    router.get('/:id/probe', async (req, res) => {
        try {
            let data = await probeService.getProbeData(req.params.id);
            if (!data) data = await probeService.runProbe(req.params.id);
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

    // ── Logs ──────────────────────────────────────────────────────────────────

    router.get('/:id/logs', async (req, res) => {
        res.json({ logs: await cameraService.getLogs(req.params.id) });
    });

    router.delete('/:id/logs', async (req, res) => {
        await cameraService.clearLogs(req.params.id);
        res.json({ success: true });
    });

    router.get('/:id/logs/download', async (req, res) => {
        const logs = await cameraService.getLogs(req.params.id);
        res.type('text/plain').send(
            logs.map(log => `[${log.created_at}] ${log.event} ${JSON.stringify(log.metadata)}`).join('\n')
        );
    });

    // ── Stream Profiles ───────────────────────────────────────────────────────

    router.put('/:id/stream-profile', async (req, res) => {
        try {
            res.json({ profile: await cameraService.selectStreamProfile(String(req.params.id), String(req.body.profileId)) });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    router.put('/:id/audio-profile', async (req, res) => {
        try {
            res.json({ codec: await cameraService.selectAudioProfile(String(req.params.id), String(req.body.codec)) });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // ── Preview / Snapshot ────────────────────────────────────────────────────

    router.get('/:id/preview/frame.jpg', async (req, res) => {
        try {
            await cameraService.recordLog(String(req.params.id), 'camera.preview.requested', { type: 'frame' });

            // B9: migrated to PreviewService.getFrame — no execFile
            const frameBuffer = await previewService.getFrame(String(req.params.id), probeService);

            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-store, no-cache');
            res.send(frameBuffer);

            void cameraService.recordLog(String(req.params.id), 'camera.preview.frame.succeeded');
        } catch (error) {
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    // B9: /snapshot also uses PreviewService.getFrame — no direct execFile/spawn
    router.get('/:id/snapshot', async (req, res) => {
        try {
            const camera = await cameraService.findById(String(req.params.id));
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }

            await cameraService.recordLog(camera.id, 'camera.snapshot.opened');
            const frameBuffer = await previewService.getFrame(String(req.params.id), probeService);
            res.type('image/jpeg').send(frameBuffer);
        } catch (error) {
            const id = req.params.id;
            await cameraService.recordLog(id, 'camera.snapshot.failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            res.status(502).json({ error: 'No se pudo generar el snapshot' });
        }
    });

    router.get('/:id/preview.mjpeg', async (req, res) => {
        try {
            await cameraService.recordLog(String(req.params.id), 'camera.preview.requested', { type: 'mjpeg' });
            await previewService.startMjpeg(String(req.params.id), res, probeService);
            void cameraService.recordLog(String(req.params.id), 'camera.preview.terminated');
        } catch (error) {
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    router.post('/:id/preview/session', async (_req, res) => {
        res.status(501).json({ error: 'Preview WebRTC/HLS no está disponible; usa /snapshot cuando la cámara lo soporte' });
    });

    router.delete('/:id/preview/session', async (_req, res) => {
        res.status(501).json({ error: 'No hay sesiones de preview activas' });
    });

    // ── Stream Controls ───────────────────────────────────────────────────────

    router.post('/:id/stream/start', async (req, res) => {
        try {
            await streamController.startStream(req.params.id);
            res.json({ success: true, message: 'Stream started' });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/:id/stream/stop', (req, res) => {
        streamController.stopStream(req.params.id);
        res.json({ success: true, message: 'Stream stopped' });
    });

    // ── Capability Evidence / Media Analysis ──────────────────────────────────

    router.get('/:id/capability-evidence', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            res.json({ cameraId: camera.id, capabilities: camera.capabilities.capabilityEvidence || [] });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/:id/media-analysis', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            res.json({ cameraId: camera.id, profiles: camera.stream_profiles || [] });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── HomeKit ───────────────────────────────────────────────────────────────

    router.get('/:id/homekit-compatibility', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            const { evaluateHomeKitCompatibility } = await import('../hksv/compatibility.js');
            const matrix = evaluateHomeKitCompatibility(camera.id, camera.stream_profiles || []);
            res.json({ ...matrix, currentMode: camera.config?.hksv_stream_mode || null });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/:id/homekit-stream-mode', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            const modeConfig = req.body;
            if (!modeConfig.selectedMode) throw new Error('Falta selectedMode');
            await cameraService.updateConfig(camera.id, { hksv_stream_mode: modeConfig });
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    // ── Diagnostics ───────────────────────────────────────────────────────────

    router.get('/:id/diagnostics/stream-url', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }

            const { cameraStreamUrl } = await import('../cameras/camera-adapter.js');
            const connection = await cameraService.getConnectionInput(req.params.id);
            if (!connection) { res.status(404).json({ error: 'Camera connection not found' }); return; }

            const url = camera.capabilities?.video?.selectedProfileId
                ? camera.stream_profiles?.find(p => p.id === camera.capabilities.video.selectedProfileId)?.streamUri
                : undefined;

            const streamUrl = url
                ? cameraStreamUrl(connection, url)
                : 'No profile selected';

            // Redact for response
            res.json({ streamUrl: streamUrl.replace(/:\/{2}[^@]+@/, '://***:***@') });
        } catch (err: any) { res.status(500).json({ error: err.message }); }
    });

    router.post('/:id/diagnostics/rtsp', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            const connection = await cameraService.getConnectionInput(req.params.id);
            if (!camera || !connection) { res.status(404).json({ error: 'Camera not found' }); return; }

            const profile = camera.stream_profiles.find(p => p.id === camera.capabilities.video.selectedProfileId)
                ?? camera.stream_profiles[0];
            const rawUrl = connection.rtsp_url ?? profile?.streamUri;

            if (!rawUrl) {
                res.json({ success: false, cameraId: camera.id, profileId: profile?.id, stages: [{ stage: 'url_normalization', success: false, message: 'No hay URL RTSP original' }] });
                return;
            }

            const { MediaProbeService } = await import('../media/media-probe.js');
            const mediaProbe = new MediaProbeService();
            const result = await mediaProbe.probeMediaStream({
                kind: 'rtsp',
                ffmpegInputArguments: ['-rtsp_transport', 'tcp', '-i', rawUrl.replace(/:\/{2}[^@]+@/, '://***:***@')],
                probeStrategy: 'ffprobe',
                redactedDescription: 'RTSP Diagnostics',
            });
            res.json({ success: result.success, output: result.stderrSummary, details: result.rawInfo });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    router.post('/:id/actions/:actionType', async (req, res) => {
        res.status(501).json({ error: 'Actions not implemented in V4' });
    });

    // ── Matter Devices ────────────────────────────────────────────────────────

    router.get('/matter/devices', async (_req: Request, res: Response) => {
        try {
            const cameras = await cameraService.findAll();
            const matterDevices = cameras.filter(cam => cam.capabilities?.matter?.available).map(cam => {
                const profiles = cam.capabilities?.video?.profiles || [];
                const hksv_video_tiers = profiles.map((p, index) => {
                    let quality = 3;
                    let targetBitrate = 1700;
                    if (p.width && p.width >= 3840) { quality = 1; targetBitrate = 4500; }
                    else if (p.width && p.width >= 1920) { quality = 2; targetBitrate = 2800; }
                    else if (p.width && p.width <= 640) { quality = 4; targetBitrate = 180; }
                    return {
                        Identifier: index + 1,
                        Quality: quality,
                        TargetAverageBitrate: p.bitrate ? Math.min(p.bitrate / 1000, targetBitrate) : targetBitrate,
                        Width: p.width || 1920,
                        Height: p.height || 1080,
                        FrameRate: p.fps || 30,
                    };
                });
                const hksv_audio_tiers = cam.capabilities?.audio?.available ? [{ Identifier: 1, TargetAverageBitrate: 24000, SampleRate: 1, BitDepth: 2, PacketTime: 20, NumberOfChannels: 1 }] : [];
                return {
                    id: cam.id,
                    deviceType: 'VideoCamera',
                    name: cam.matter_device_name || cam.name,
                    vendorId: cam.matter_vendor_id,
                    productId: cam.matter_product_id,
                    endpoints: {
                        video: { codecs: profiles.map(profile => profile.codec).filter(Boolean), resolutions: profiles, hksv_tiers: hksv_video_tiers, rtsp_url: cam.rtsp_url, remuxOnly: cam.capabilities?.matter?.supportsMatterRemux },
                        audio: { enabled: cam.capabilities?.audio?.available, codec: cam.capabilities?.audio?.codecs, samplerate: cam.capabilities?.audio?.sampleRates, twoWay: cam.capabilities?.controls?.twoWayAudio, hksv_tiers: hksv_audio_tiers },
                        networking: { ipv4Address: cam.ip, port: cam.port, forceIpv4: true },
                        sensors: { motion: cam.capabilities?.controls?.motionEvents },
                        controls: { light: cam.capabilities?.controls?.lightControl, siren: cam.capabilities?.controls?.sirenControl },
                        features: { hksv: cam.capabilities?.controls?.motionEvents },
                    },
                    capabilities: cam.capabilities,
                    status: cam.status,
                };
            });
            res.json({ devices: matterDevices });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to fetch Matter devices' });
        }
    });

    // ── YOLOv10 ───────────────────────────────────────────────────────────────

    router.put('/:id/yolo', async (req: Request, res: Response) => {
        try {
            const camera = await cameraService.findById(String(req.params.id));
            if (!camera?.capabilities.yolo.available) {
                res.status(409).json({ available: false, reason: camera?.capabilities.yolo.reason ?? 'Runtime YOLO no disponible' });
                return;
            }
            await cameraService.updateConfig(camera.id, { yolo_enabled: Boolean(req.body.enabled) });
            getWsBridge()?.broadcastCamerasUpdated('camera.updated', camera.id);
            res.json({ success: true, enabled: Boolean(req.body.enabled) });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Matter (deprecated, preserved for backwards compat) ──────────────────

    router.post('/:id/matter/commission', async (_req, res) => {
        res.status(501).json({ error: 'Matter commission deprecated here' });
    });

    router.delete('/:id/matter/commission', async (_req, res) => {
        res.status(501).json({ error: 'Matter decommission deprecated here' });
    });

    router.get('/:id/matter/status', async (_req, res) => {
        res.status(501).json({ error: 'Matter status deprecated here' });
    });

    return router;
}
