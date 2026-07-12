import { Router, Request, Response } from 'express';
import { CoreServiceFacade } from '../../core/CoreServiceFacade';
import { instrumentRequest } from '../instrumentation';
import { ScryptedMimeTypes } from '@scrypted/types';
import crypto from 'crypto';

function publicError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return message.replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi, '$1***:***@').slice(0, 512);
}

const activeSessions = new Map<string, any>();

export function createScryptedRouter(coreService: CoreServiceFacade, scrypted: any): Router {
    const router = Router();
    
    // Proteger API universal con autenticación explícita
    router.use((_req, res, next) => {
        if (!res.locals.username) {
            res.status(401).json({ error: 'NOT_AUTHENTICATED' });
            return;
        }
        next();
    });

    // ── Plugins ──────────────────────────────────────────────────────────────
    router.get('/plugins', async (_req: Request, res: Response) => {
        try {
            const plugins = await coreService.listPlugins();
            res.json({ plugins });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to fetch plugins', detail: publicError(err) });
        }
    });

    // ── Devices (DeviceModel Projection) ──────────────────────────────────────
    router.get('/devices', async (req: Request, res: Response) => {
        instrumentRequest(req, res);
        try {
            const { devices, errors } = await coreService.listDevices();
            res.json({ devices, errors });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to fetch devices', detail: publicError(err) });
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
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to fetch device', detail: publicError(err) });
        }
    });

    router.get('/devices/:id/interfaces', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ interfaces: device.interfaces });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed', detail: publicError(err) });
        }
    });

    router.get('/devices/:id/settings', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ settings: device.settings });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed', detail: publicError(err) });
        }
    });

    // POST /api/scrypted/devices/:id/settings
    router.post('/devices/:id/settings', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const { key, value } = req.body;
            if (!key) {
                res.status(400).json({ error: 'Missing setting key' });
                return;
            }

            const pair = scrypted.devices[deviceId];
            if (!pair || !pair.proxy) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }

            const proxy = pair.proxy;
            if (typeof proxy.getSettings !== 'function' || typeof proxy.putSetting !== 'function') {
                res.status(400).json({ error: 'Device does not support settings' });
                return;
            }

            // Validar que la llave existe y no sea de solo lectura
            const settings = await proxy.getSettings();
            const currentSetting = settings.find((s: any) => s.key === key);
            if (!currentSetting) {
                res.status(400).json({ error: `Setting key '${key}' does not exist on this device` });
                return;
            }
            if (currentSetting.readonly) {
                res.status(400).json({ error: `Setting key '${key}' is read-only` });
                return;
            }

            console.log(`[ScryptedRouter] Modifying setting '${key}' on device ${deviceId}`);
            await proxy.putSetting(key, value);
            res.json({ success: true });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to put setting', detail: publicError(err) });
        }
    });

    // GET /api/scrypted/devices/:id/creator-settings
    router.get('/devices/:id/creator-settings', async (req: Request, res: Response) => {
        try {
            const creatorDeviceId = req.params.id as string;
            const pair = scrypted.devices[creatorDeviceId];
            if (!pair || !pair.proxy) {
                res.status(404).json({ error: `Creator device proxy not found for ID: ${creatorDeviceId}` });
                return;
            }

            const proxy = pair.proxy;
            if (typeof proxy.getCreateDeviceSettings !== 'function') {
                res.status(400).json({ error: 'Device is not a DeviceCreator' });
                return;
            }

            const settings = await proxy.getCreateDeviceSettings();
            res.json({ settings });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to get creator settings', detail: publicError(err) });
        }
    });

    // POST /api/scrypted/devices/:id/create-device
    router.post('/devices/:id/create-device', async (req: Request, res: Response) => {
        try {
            const creatorDeviceId = req.params.id as string;
            const settings = req.body;

            const pair = scrypted.devices[creatorDeviceId];
            if (!pair || !pair.proxy) {
                res.status(404).json({ error: `Creator device proxy not found for ID: ${creatorDeviceId}` });
                return;
            }

            const proxy = pair.proxy;
            if (typeof proxy.createDevice !== 'function') {
                res.status(400).json({ error: 'Device is not a DeviceCreator' });
                return;
            }

            console.log(`[ScryptedRouter] Creating device on creator ${creatorDeviceId}`);
            const newDeviceId = await proxy.createDevice(settings);
            res.json({ success: true, deviceId: newDeviceId });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to create device', detail: publicError(err) });
        }
    });

    // POST /api/scrypted/devices/:id/webrtc/negotiate
    router.post('/devices/:id/webrtc/negotiate', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const { offer } = req.body;
            if (!offer) {
                res.status(400).json({ error: 'Missing SDP offer' });
                return;
            }

            const pair = scrypted.devices[deviceId];
            if (!pair || !pair.proxy) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }

            const proxy = pair.proxy as any;
            if (typeof proxy.getVideoStream !== 'function') {
                res.status(400).json({ error: 'Device does not support video streaming' });
                return;
            }

            console.log(`[ScryptedRouter] Starting upstream WebRTC negotiation for camera ${deviceId}`);
            const mediaObject = await proxy.getVideoStream();
            const signalingChannel = await scrypted.mediaManager.convertMediaObject(
                mediaObject,
                ScryptedMimeTypes.RTCSignalingChannel
            );

            if (!signalingChannel) {
                res.status(400).json({ error: 'WebRTC signaling not supported for this camera' });
                return;
            }

            let resolveAnswer: (sdp: string) => void;
            let rejectAnswer: (err: Error) => void;
            const answerPromise = new Promise<string>((resolve, reject) => {
                resolveAnswer = resolve;
                rejectAnswer = reject;
            });

            const session: any = {
                options: {
                    requiresOffer: true,
                    disableTrickle: true
                },
                __proxy_props: {
                    options: {
                        requiresOffer: true,
                        disableTrickle: true
                    }
                },
                createLocalDescription: async (type: string, setup: any, sendIceCandidate: any) => {
                    return {
                        type: 'offer',
                        sdp: offer
                    };
                },
                setRemoteDescription: async (description: any, setup: any) => {
                    resolveAnswer(description.sdp);
                },
                addIceCandidate: async () => {},
                getOptions: async () => session.options
            };

            const control = await signalingChannel.startRTCSignalingSession(session);
            const answer = await Promise.race([
                answerPromise,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('WebRTC negotiation timeout')), 15000))
            ]);

            const sessionId = crypto.randomUUID();
            if (control) {
                activeSessions.set(sessionId, control);
            }

            res.json({ answer, sessionId });
        } catch (err: unknown) {
            console.error('[ScryptedRouter] WebRTC negotiate error:', err);
            res.status(500).json({ error: 'WebRTC negotiation failed', detail: publicError(err) });
        }
    });

    // DELETE /api/scrypted/devices/:id/webrtc/:sessionId
    router.delete('/devices/:id/webrtc/:sessionId', async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.params as any;
            const control = activeSessions.get(sessionId);
            if (control) {
                console.log(`[ScryptedRouter] Ending upstream WebRTC session ${sessionId}`);
                try {
                    await control.endSession();
                } catch (e) {
                    console.warn('[ScryptedRouter] Error ending upstream RTCSessionControl:', e);
                }
                activeSessions.delete(sessionId);
            }
            res.json({ success: true });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed to end session', detail: publicError(err) });
        }
    });


    router.get('/devices/:id/media-options', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ mediaOptions: device.media.options });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed', detail: publicError(err) });
        }
    });

    router.get('/devices/:id/capabilities', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ capabilities: device.capabilities });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed', detail: publicError(err) });
        }
    });

    router.get('/devices/:id/diagnostics', async (req: Request, res: Response) => {
        try {
            const deviceId = req.params.id as string;
            const device = await coreService.getDevice(deviceId);
            if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
            res.json({ diagnostics: device.diagnostics });
        } catch (err: unknown) {
            res.status(500).json({ error: 'Failed', detail: publicError(err) });
        }
    });

    return router;
}
