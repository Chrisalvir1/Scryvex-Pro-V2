import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createConnection } from 'node:net';
import { CameraService, CreateCameraInput } from './camera-service';
import { CameraStreamController } from './camera-stream-controller';
import { CameraProbe } from './camera-probe';
import { MatterPairingService } from './matter-pairing';
import { CameraConnectionInput, cameraStreamUrl } from '../cameras/camera-adapter';

const execFileAsync = promisify(execFile);

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


/**
 * Mounts REST endpoints for camera CRUD under /api/cameras.
 * All routes require the user to be authenticated (handled by parent app middleware).
 */
export function createCamerasRouter(
    cameraService: CameraService, 
    pool: Pool, 
    getWsBridge: () => import('./cameras-ws').CamerasWebSocketBridge | undefined
): Router {
    const router = Router();
    const streamController = new CameraStreamController(cameraService);
    const probeService = null; // Removed, now injected from locals
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
            getWsBridge()?.broadcastCamerasUpdated('camera.created', camera.id);
            res.status(201).json({ camera });
            const probeSvc = (req.app.locals.probeService as import('./camera-probe').CameraProbe);
            if (probeSvc) void probeSvc.runProbe(camera.id).then(() => getWsBridge()?.broadcastCamerasUpdated('camera.updated', camera.id)).catch((error: any) => console.error('[cameras-router] async discovery failed:', error.message));
        } catch (err: any) {
            console.error('[cameras-router] POST /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to create camera', detail: err.message });
        }
    });

    // Test ONVIF - temporarily disabled until diagnostic service handles it.
    router.post('/test-onvif-port', async (req, res) => {
        res.status(501).json({ error: 'Not implemented in V4' });
    });

    router.post('/:id/discover', async (req, res) => { try { const probeService = (req.app.locals.probeService as import('./camera-probe').CameraProbe); const capabilities = await probeService.runProbe(String(req.params.id)); getWsBridge()?.broadcastCamerasUpdated('camera.updated', String(req.params.id)); res.json({ capabilities }); } catch (err: any) { res.status(502).json({ error: err.message }); } });
    router.get('/:id/capabilities', async (req, res) => { const camera = await cameraService.findById(req.params.id); if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; } res.json({ capabilities: camera.capabilities, discovery_status: camera.discovery_status, last_error: camera.last_error }); });
    router.post('/:id/test-connection', async (req, res) => { try { const camera = await cameraService.findById(req.params.id); if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; } const probeService = (req.app.locals.probeService as import('./camera-probe').CameraProbe); const capabilities = await probeService.runProbe(camera.id); res.json({ success: capabilities.discoveryStatus === 'online', status: capabilities.discoveryStatus }); } catch (err: any) { res.status(502).json({ success: false, status: 'error', error: err.message }); } });
    router.get('/:id/logs', async (req, res) => { res.json({ logs: await cameraService.getLogs(req.params.id) }); });
    router.delete('/:id/logs', async (req, res) => { await cameraService.clearLogs(req.params.id); res.json({ success: true }); });
    router.get('/:id/logs/download', async (req, res) => { const logs = await cameraService.getLogs(req.params.id); res.type('text/plain').send(logs.map(log => `[${log.created_at}] ${log.event} ${JSON.stringify(log.metadata)}`).join('\n')); });
    router.put('/:id/stream-profile', async (req, res) => { try { res.json({ profile: await cameraService.selectStreamProfile(String(req.params.id), String(req.body.profileId)) }); } catch (err: any) { res.status(400).json({ error: err.message }); } });
    router.put('/:id/audio-profile', async (req, res) => { try { res.json({ codec: await cameraService.selectAudioProfile(String(req.params.id), String(req.body.codec)) }); } catch (err: any) { res.status(400).json({ error: err.message }); } });
    router.post('/:id/preview/session', async (_req, res) => { res.status(501).json({ error: 'Preview WebRTC/HLS no está disponible; usa /snapshot cuando la cámara lo soporte' }); });
    router.delete('/:id/preview/session', async (_req, res) => { res.status(501).json({ error: 'No hay sesiones de preview activas' }); });

    // DELETE /api/cameras/:id — remove a camera and its events (CASCADE)
    router.delete('/:id', async (req: Request, res: Response) => {
        try {
            const id      = String(req.params['id']);
            const deleted = await cameraService.delete(id);
            if (!deleted) {
                res.status(404).json({ error: 'Camera not found' });
                return;
            }
            getWsBridge()?.broadcastCamerasUpdated('camera.deleted', id);
            // 204 or 200, let's keep the existing pattern
            res.json({ success: true, id });
        } catch (err: any) {
            console.error('[cameras-router] DELETE /api/cameras error:', err.message);
            res.status(500).json({ error: 'Failed to delete camera', detail: err.message });
        }
    });

    // ── Actions ────────────────────────────────────────────────────────────────
    router.post('/:id/actions/:actionType', async (req, res) => {
        res.status(501).json({ error: 'Not implemented in V4' });
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

    router.get('/:id/preview/frame.jpg', async (req, res) => {
        try {
            await cameraService.recordLog(String(req.params.id), 'camera.preview.requested', { type: 'frame' });
            
            // This is a stub for the unified service injection
            const previewService = (req.app.locals.previewService as import('../media/preview-service').PreviewService);
            if (!previewService) throw new Error('PreviewService no inyectado');
            
            // Ignorar para eventos
            const frameBuffer = await previewService.getFrame(String(req.params.id));
            
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-store, no-cache');
            res.send(frameBuffer);
            
            void cameraService.recordLog(String(req.params.id), 'camera.preview.frame.succeeded');
        } catch (error) {
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    router.get('/:id/preview.mjpeg', async (req, res) => {
        try {
            await cameraService.recordLog(String(req.params.id), 'camera.preview.requested', { type: 'mjpeg' });
            
            const previewService = (req.app.locals.previewService as import('../media/preview-service').PreviewService);
            if (!previewService) throw new Error('PreviewService no inyectado');

            await previewService.startMjpeg(String(req.params.id), res);
            
            void cameraService.recordLog(String(req.params.id), 'camera.preview.terminated');
        } catch (error) { 
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); 
        }
    });

    // ── Codec Probe / Analytics ────────────────────────────────────────────────

    router.get('/:id/probe', async (req, res) => {
        try {
            const probeSvc = (req.app.locals.probeService as import('./camera-probe').CameraProbe);
            let data = await probeSvc?.getProbeData(req.params.id);
            if (!data) {
                data = await probeSvc?.runProbe(req.params.id);
            }
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

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

    router.get('/:id/homekit-compatibility', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            
            const { evaluateHomeKitCompatibility } = await import('../hksv/compatibility.js');
            const matrix = evaluateHomeKitCompatibility(camera.id, camera.stream_profiles || []);
            res.json({
                ...matrix,
                currentMode: camera.config?.hksv_stream_mode || null
            });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.put('/:id/homekit-stream-mode', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }
            const modeConfig = req.body;
            // Valida el formato básico
            if (!modeConfig.selectedMode) throw new Error('Falta selectedMode');
            await cameraService.updateConfig(camera.id, { hksv_stream_mode: modeConfig });
            res.json({ success: true });
        } catch (err: any) {
            res.status(400).json({ error: err.message });
        }
    });

    router.get('/:id/diagnostics/stream-url', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            const connection = await cameraService.getConnectionInput(req.params.id);
            if (!camera || !connection) { res.status(404).json({ error: 'Camera not found' }); return; }
            
            const { cameraStreamUrl } = await import('../cameras/camera-adapter.js');
            
            const url = camera.capabilities?.video?.selectedProfileId
                ? camera.stream_profiles?.find(p => p.id === camera.capabilities.video.selectedProfileId)?.streamUri
                : undefined;
                
        } catch (err: any) { res.status(500).json({ error: err.message }); }
    });

    router.post('/:id/diagnostics/rtsp', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            const connection = await cameraService.getConnectionInput(req.params.id);
            if (!camera || !connection) { res.status(404).json({ error: 'Camera not found' }); return; }
            
            const profile = camera.stream_profiles.find(item => item.id === camera.capabilities.video.selectedProfileId) ?? camera.stream_profiles[0];
            const rawUrl = connection.rtsp_url ?? profile?.streamUri;
            
            const stages: any[] = [];
            
            if (!rawUrl) {
                stages.push({ stage: 'url_normalization', success: false, message: 'No hay URL RTSP original' });
                res.json({ success: false, cameraId: camera.id, profileId: profile?.id, stages });
                return;
            }

            const { cameraStreamUrl } = await import('../cameras/camera-adapter.js');
            const mediaProbe = (req.app.locals.probeService as any)?.mediaProbe as import('../media/media-probe').MediaProbeService;
            if (!mediaProbe) { res.status(501).json({ error: 'Media probe not available' }); return; }
            const result = await mediaProbe.probeMediaStream({
                kind: 'rtsp',
                ffmpegInputArguments: ['-rtsp_transport', 'tcp', '-i', connection.rtsp_url ?? ''],
                probeStrategy: 'ffprobe',
                redactedDescription: 'RTSP Diagnostics'
            });
            res.json({ success: result.success, output: result.stderrSummary, details: result.rawInfo });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/:id/probe/hevc', async (req, res) => {
        try {
            const probeSvc = (req.app.locals.probeService as import('./camera-probe').CameraProbe);
            const data = await probeSvc?.toggleHEVC(req.params.id, req.body.enabled);
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/:id/snapshot', async (req, res) => {
        const camera = await cameraService.findById(String(req.params.id)); const connection = await cameraService.getConnectionInput(String(req.params.id)); if (!camera || !connection) { res.status(404).json({ error: 'Camera not found' }); return; }
        const profile = camera.stream_profiles.find(p => p.id === camera.capabilities.video.selectedProfileId) ?? camera.stream_profiles[0];
        const rawUrl = connection.rtsp_url ?? profile?.streamUri;
        if (!rawUrl) { res.status(404).json({ error: 'No hay stream RTSP detectado para generar un snapshot' }); return; }
        try {
            const streamUrl = cameraStreamUrl(connection, rawUrl);
            const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-rtsp_flags', 'prefer_tcp', '-analyzeduration', '10000000', '-probesize', '10000000', '-i', streamUrl, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 12_000 });
            await cameraService.recordLog(camera.id, 'camera.snapshot.opened');
            res.type('image/jpeg').send(stdout);
        } catch (error) { await cameraService.recordLog(camera.id, 'camera.snapshot.failed', { error: error instanceof Error ? error.message : String(error) }); res.status(502).json({ error: 'No se pudo abrir el stream RTSP para generar el snapshot' }); }
    });

    // ── Matter Integration Endpoint ────────────────────────────────────────────

    router.post('/:id/matter/commission', async (req, res) => {
        res.status(501).json({ error: 'Matter commission deprecated here' });
    });

    router.delete('/:id/matter/commission', async (req, res) => {
        res.status(501).json({ error: 'Matter decommission deprecated here' });
    });

    router.get('/:id/matter/status', async (req, res) => {
        res.status(501).json({ error: 'Matter status deprecated here' });
    });

    // GET /api/cameras/matter/devices — dedicated endpoint for Matterbridge to consume
    router.get('/matter/devices', async (req: Request, res: Response) => {
        try {
            const cameras = await cameraService.findAll();
            
            // Format cameras strictly matching the Matter object model
            const matterDevices = cameras.filter(cam => cam.capabilities?.matter?.available).map(cam => {
                const profiles = cam.capabilities?.video?.profiles || [];
                
                // Map HKSV Video Tiers (Section 2 of HKSV Specification)
                const hksv_video_tiers = profiles.map((p, index) => {
                    let quality = 3; // Default to Medium
                    let targetBitrate = 1700;
                    if (p.width && p.width >= 3840) { quality = 1; targetBitrate = 4500; } // Highest (4K)
                    else if (p.width && p.width >= 1920) { quality = 2; targetBitrate = 2800; } // High (2K/1080p)
                    else if (p.width && p.width <= 640) { quality = 4; targetBitrate = 180; } // Low (360p)

                    return {
                        Identifier: index + 1,
                        Quality: quality,
                        TargetAverageBitrate: p.bitrate ? Math.min(p.bitrate / 1000, targetBitrate) : targetBitrate,
                        Width: p.width || 1920,
                        Height: p.height || 1080,
                        FrameRate: p.fps || 30
                    };
                });

                // Map HKSV Audio Tiers (Section 4.4 of HKSV Specification)
                // Apple strictly requires Opus (Codec = 3) and 16kHz or 24kHz capture, 48kHz transmission.
                const hksv_audio_tiers = cam.capabilities?.audio?.available ? [{
                    Identifier: 1,
                    TargetAverageBitrate: 24000,
                    SampleRate: 1, // 1 = 16kHz (Capture rate)
                    BitDepth: 2, // 2 = 16-bit
                    PacketTime: 20, // Mandatory 20ms
                    NumberOfChannels: 1 // Mandatory 1 channel
                }] : [];

                return {
                    id: cam.id,
                    deviceType: 'VideoCamera',
                    name: cam.matter_device_name || cam.name,
                    vendorId: cam.matter_vendor_id,
                    productId: cam.matter_product_id,
                    endpoints: {
                        video: {
                            codecs: profiles.map(profile => profile.codec).filter(Boolean),
                            resolutions: profiles,
                            hksv_tiers: hksv_video_tiers,
                            rtsp_url: cam.rtsp_url,
                            remuxOnly: cam.capabilities?.matter?.supportsMatterRemux // tvOS 27 H.265 Remux support
                        },
                        audio: {
                            enabled: cam.capabilities?.audio?.available, // If false, export as Video-Only
                            codec: cam.capabilities?.audio?.codecs,
                            samplerate: cam.capabilities?.audio?.sampleRates,
                            twoWay: cam.capabilities?.controls?.twoWayAudio,
                            hksv_tiers: hksv_audio_tiers
                        },
                        networking: {
                            ipv4Address: cam.ip,
                            port: cam.port,
                            forceIpv4: true // Ensures Matter handles Ethernet or Wi-Fi identically via IPv4
                        },
                        sensors: {
                            motion: cam.capabilities?.controls?.motionEvents // Triggers HomeKit Secure Video
                        },
                        controls: {
                            light: cam.capabilities?.controls?.lightControl,
                            siren: cam.capabilities?.controls?.sirenControl
                        },
                        features: {
                            hksv: cam.capabilities?.controls?.motionEvents // Enable HKSV if motion is available
                        }
                    },
                    capabilities: cam.capabilities,
                    status: cam.status
                };
            });

            res.json({ devices: matterDevices });
        } catch (err: any) {
            console.error('[cameras-router] GET /api/cameras/matter/devices error:', err.message);
            res.status(500).json({ error: 'Failed to fetch Matter devices' });
        }
    });

    // ── YOLOv10 Endpoint ──────────────────────────────────────────────────────

    router.put('/:id/yolo', async (req: Request, res: Response) => {
        try {
            const camera = await cameraService.findById(String(req.params.id));
            if (!camera?.capabilities.yolo.available) { res.status(409).json({ available: false, reason: camera?.capabilities.yolo.reason ?? 'Runtime YOLO no disponible en esta arquitectura' }); return; }
            await cameraService.updateConfig(camera.id, { yolo_enabled: Boolean(req.body.enabled) });
            getWsBridge()?.broadcastCamerasUpdated('camera.updated', camera.id);
            res.json({ success: true, enabled: Boolean(req.body.enabled) });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
    return router;
}
