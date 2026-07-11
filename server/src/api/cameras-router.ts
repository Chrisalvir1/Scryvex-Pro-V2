import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { createConnection } from 'node:net';
import { CameraService, CreateCameraInput } from './camera-service';
import { CameraStreamController } from './camera-stream-controller';
import { CameraProbe } from './camera-probe';
import { PreviewService } from '../media/preview-service';
import { MatterPairingService } from './matter-pairing';
import { OnvifAdapter } from '../cameras/adapters/onvif-adapter';
import { SnapshotFrameCache } from '../media/snapshot-cache';

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
        providerRegistry: import('../cameras/camera-provider-registry').CameraProviderRegistry;
        resolverRegistry: import('../media/media-resolvers').MediaInputResolverRegistry;
        secretStore: import('../media/credential-store').ConnectionSecretStore;
        mediaProbe: import('../media/media-probe').MediaProbeService;
        sessionManager: import('../media/media-session-manager').MediaSourceSessionManager;
        selector: import('../media/media-selector').MediaSourceSelector;
        ffmpegRunner: import('../media/media-process-runner').IMediaProcessRunner;
        liveSessionManager: import('../media/live-media-session').LiveMediaSessionManager;
    }
): Router {
    const { probeService, previewService, onvifAdapter, providerRegistry, resolverRegistry, secretStore, mediaProbe, sessionManager, liveSessionManager } = services;
    const router = Router();
    const streamController = new CameraStreamController(cameraService);

    // ── Snapshot frame cache (single-flight per camera) ───────────────────────
    const snapshotCache = new SnapshotFrameCache(
        services.selector,
        services.ffmpegRunner,
        services.sessionManager,
    );

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
            // Frontend might send ip/onvif_port, or backend expects host/port.
            const { ip, onvif_port, host, port, username, password } = req.body;

            const targetHost = host || ip;
            const targetPort = port || onvif_port;

            if (!targetHost) {
                res.status(400).json({ error: 'host or ip is required' });
                return;
            }

            const candidatePorts = targetPort ? [Number(targetPort)] : [80, 8080, 8899, 8000, 8001, 8888, 554];
            const result = await onvifAdapter.testConnection(targetHost, candidatePorts, username, password);
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

    // ── /preview/frame.jpg — finite JPEG, Content-Length, abort-aware ─────────
    router.get('/:id/preview/frame.jpg', async (req, res) => {
        const ac = new AbortController();
        req.on('close', () => ac.abort());

        try {
            const camera = await cameraService.findById(String(req.params.id));
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }

            let probedSources = await probeService.getProbedSources(String(req.params.id));
            if (!probedSources || probedSources.length === 0) {
                await probeService.runProbe(String(req.params.id));
                probedSources = await probeService.getProbedSources(String(req.params.id));
            }

            if (!probedSources || probedSources.length === 0) {
                res.status(503).json({ error: 'No hay perfiles validados. Ejecute Detectar primero.' });
                return;
            }

            const { jpeg, profileId, codec, ttlMs, source } = await snapshotCache.getFrame(
                String(req.params.id),
                probedSources,
                ac.signal,
            );

            if (res.headersSent) return;

            res
                .status(200)
                .set('Content-Type', 'image/jpeg')
                .set('Content-Length', String(jpeg.length))
                .set('Cache-Control', 'no-store')
                .set('X-Content-Type-Options', 'nosniff')
                .set('X-Frame-Profile', profileId)
                .set('X-Frame-Codec', codec)
                .set('X-Frame-Source', source)
                .set('X-Frame-TTL', String(ttlMs))
                .end(jpeg);
        } catch (err) {
            if (res.headersSent) return;
            if ((err as any)?.name === 'AbortError' || ac.signal.aborted) return;
            res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
        }
    });

    // B9: /snapshot — kept for backward compat
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
            await previewService.startMjpeg(String(req.params.id), res, probeService, cameraService);
        } catch (error) {
            if (!res.headersSent) {
                res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
            }
        }
    });

    router.get('/:id/preview/diagnostics', async (req, res) => {
        try {
            const diag = await previewService.getDiagnosticsFrame(String(req.params.id), probeService);
            res.json(diag);
        } catch (error) {
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    router.post('/:id/preview/hls/sessions', async (req, res) => {
        try {
            const camera = await cameraService.findById(req.params.id);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }

            const profileId = camera.capabilities?.video?.selectedProfileId;
            if (!profileId) {
                res.status(400).json({ error: 'No video profile selected' });
                return;
            }

            const sessionId = await liveSessionManager.startSession(
                camera.id, 
                profileId, 
                probeService, 
                cameraService, 
                req.app.locals.abortController?.signal // Optional global abort
            );
            
            res.json({ sessionId });
        } catch (error) {
            res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
        }
    });

    router.get('/:id/preview/hls/:sessionId/index.m3u8', async (req, res) => {
        const { id, sessionId } = req.params;
        const camera = await cameraService.findById(id);
        const profileId = camera?.capabilities?.video?.selectedProfileId;
        if (!profileId) { res.status(404).end(); return; }

        liveSessionManager.heartbeatConsumer(id, profileId, sessionId);
        const dir = liveSessionManager.getHlsDir(id, profileId);
        if (!dir) { res.status(404).end(); return; }

        const file = require('path').join(dir, 'index.m3u8');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store, no-cache');
        res.sendFile(file, (err) => {
            if (err) res.status(404).end();
        });
    });

    router.get('/:id/preview/hls/:sessionId/:segment', async (req, res) => {
        const { id, sessionId, segment } = req.params;
        const camera = await cameraService.findById(id);
        const profileId = camera?.capabilities?.video?.selectedProfileId;
        if (!profileId || !segment.endsWith('.ts')) { res.status(404).end(); return; }

        liveSessionManager.heartbeatConsumer(id, profileId, sessionId);
        const dir = liveSessionManager.getHlsDir(id, profileId);
        if (!dir) { res.status(404).end(); return; }

        const file = require('path').join(dir, segment);
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'no-store, no-cache');
        res.sendFile(file, (err) => {
            if (err) res.status(404).end();
        });
    });

    router.post('/:id/preview/hls/:sessionId/heartbeat', async (req, res) => {
        const { id, sessionId } = req.params;
        const camera = await cameraService.findById(id);
        const profileId = camera?.capabilities?.video?.selectedProfileId;
        if (!profileId) { res.status(404).json({ error: 'No profile' }); return; }

        const ok = liveSessionManager.heartbeatConsumer(id, profileId, sessionId);
        if (ok) res.json({ success: true });
        else res.status(404).json({ error: 'Session not active' });
    });

    router.delete('/:id/preview/hls/:sessionId', async (req, res) => {
        const { id, sessionId } = req.params;
        const camera = await cameraService.findById(id);
        const profileId = camera?.capabilities?.video?.selectedProfileId;
        if (profileId) {
            liveSessionManager.removeConsumer(id, profileId, sessionId);
        }
        res.json({ success: true });
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
            const deviceId = req.params.id;
            const camera = await cameraService.findById(deviceId);
            if (!camera) { res.status(404).json({ error: 'Camera not found' }); return; }

            const provider = await providerRegistry.getProviderForCamera(deviceId);
            const discovery = await provider.getMediaSources(deviceId);
            if (!discovery.available || discovery.sources.length === 0) {
                res.status(400).json({ error: 'No media sources available' });
                return;
            }

            const profile = camera.stream_profiles?.find(p => p.id === camera.capabilities?.video?.selectedProfileId)
                ?? camera.stream_profiles?.[0];
            const descriptorId = profile?.id ?? discovery.sources[0]!.id;
            
            const descriptor = discovery.sources.find(s => s.id === descriptorId);
            if (!descriptor) {
                res.status(400).json({ error: 'Source descriptor not found' });
                return;
            }

            const pluginId = (provider as any).pluginId ?? 'scryvex-core';
            
            // AbortController para timeout de seguridad en la respuesta
            const ac = new AbortController();
            const timeoutId = setTimeout(() => ac.abort(), 15000);

            try {
                const result = await sessionManager.executeWithSourceRetry(
                    deviceId,
                    descriptorId,
                    async (input, signal) => mediaProbe.probeMediaStream(input, undefined, signal),
                    pluginId,
                    ac.signal
                );
                res.json({ success: result.success, output: result.stderrSummary, details: result.rawInfo });
            } finally {
                clearTimeout(timeoutId);
            }
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    router.post('/:id/actions/:actionType', async (req, res) => {
        try {
            const deviceId = String(req.params.id);
            const actionType = String(req.params.actionType);
            const payload: any = req.body;

            const provider = await providerRegistry.getProviderForCamera(deviceId);
            if (!provider.executeCapability || !provider.listCapabilities) {
                res.status(400).json({ error: 'Provider does not support capability execution' });
                return;
            }

            const capabilities = await provider.listCapabilities(deviceId);
            const capability = capabilities.find(c => c.operation === actionType);
            if (!capability || !capability.controllable) {
                res.status(400).json({ error: 'Capability no existe o no es controlable' });
                return;
            }

            // Validar payload
            if (actionType.startsWith('ptz:')) {
                if (payload.x !== undefined && (payload.x < -1 || payload.x > 1)) throw new Error('x debe estar entre -1 y 1');
                if (payload.y !== undefined && (payload.y < -1 || payload.y > 1)) throw new Error('y debe estar entre -1 y 1');
                if (payload.zoom !== undefined && (payload.zoom < -1 || payload.zoom > 1)) throw new Error('zoom debe estar entre -1 y 1');
                if (payload.durationSeconds !== undefined && (payload.durationSeconds < 0 || payload.durationSeconds > 60)) throw new Error('durationSeconds fuera de límite seguro');
            } else if (actionType.startsWith('relay:')) {
                if (payload.state !== 'active' && payload.state !== 'inactive') throw new Error('state debe ser active o inactive');
            }

            await provider.executeCapability(deviceId, actionType, payload);

            // Registrar resultado saneado
            const safePayload = { ...payload };
            delete safePayload.profileToken; // Por si acaso fue enviado erróneamente
            delete safePayload.relayToken;

            await cameraService.recordLog(deviceId, 'camera.action.executed', {
                action: actionType,
                payload: safePayload
            });

            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
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
