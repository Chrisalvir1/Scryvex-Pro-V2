import { activeSessions, closeSession, stopWebRTCCleanupInterval, createScryptedRouter } from '../../src/api/scrypted/scrypted-router';

describe('WebRTC Sessions, Heartbeats & Router Endpoints', () => {
    let mockControl: any;
    let mockCoreService: any;
    let mockScrypted: any;
    let negotiateHandler: any;
    let deleteHandler: any;
    let heartbeatHandler: any;

    beforeEach(() => {
        activeSessions.clear();
        mockControl = {
            endSession: jest.fn().mockResolvedValue(undefined)
        };
        mockCoreService = {};
        
        // Mock scrypted object
        mockScrypted = {
            devices: {
                'cam-1': {
                    proxy: {
                        getVideoStream: jest.fn().mockResolvedValue({}),
                    }
                }
            },
            mediaManager: {
                convertMediaObject: jest.fn().mockResolvedValue({
                    startRTCSignalingSession: jest.fn().mockResolvedValue(mockControl)
                })
            }
        };

        const mockRouter: any = {
            post: (path: string, handler: any) => {
                if (path.includes('/negotiate')) negotiateHandler = handler;
                if (path.includes('/heartbeat')) heartbeatHandler = handler;
            },
            delete: (path: string, handler: any) => {
                if (path.includes('/:sessionId')) deleteHandler = handler;
            },
            get: jest.fn(),
            use: jest.fn(),
        };

        // Intercept Express Router
        const express = require('express');
        const originalRouter = express.Router;
        express.Router = () => mockRouter;

        createScryptedRouter(mockCoreService, mockScrypted);

        express.Router = originalRouter;
    });

    afterAll(() => {
        stopWebRTCCleanupInterval();
    });

    test('a) heartbeat prolonga la sesión', async () => {
        const sessionId = 'session-123';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-1',
            control: mockControl,
            createdAt: now - 50000,
            lastActivityAt: now - 50000
        });

        // Simular heartbeat endpoint
        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-1', sessionId }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        await heartbeatHandler(req, res);
        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(activeSessions.get(sessionId)!.lastActivityAt).toBeGreaterThan(now - 1000);
    });

    test('b) sesión sin heartbeat expira', async () => {
        const sessionId = 'session-expired';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-1',
            control: mockControl,
            createdAt: now - 100000,
            lastActivityAt: now - 100000
        });

        // Trigger manual cleanup checks
        const TIMEOUT_MS = 60 * 1000;
        for (const [sid, session] of activeSessions.entries()) {
            if (now - session.lastActivityAt > TIMEOUT_MS) {
                await closeSession(sid, 'Timeout');
            }
        }

        expect(activeSessions.has(sessionId)).toBe(false);
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);
    });

    test('c) DELETE con cameraId distinto devuelve error y no cierra', async () => {
        const sessionId = 'session-diff';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-real',
            control: mockControl,
            createdAt: now,
            lastActivityAt: now
        });

        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-fake', sessionId }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        await deleteHandler(req, res);
        expect(status).toBe(400);
        expect(body.error).toBe('Session camera ID mismatch');
        expect(activeSessions.has(sessionId)).toBe(true);
        expect(mockControl.endSession).not.toHaveBeenCalled();
    });

    test('d) cierre explícito elimina la sesión', async () => {
        const sessionId = 'session-close';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-1',
            control: mockControl,
            createdAt: now,
            lastActivityAt: now
        });

        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-1', sessionId }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        await deleteHandler(req, res);
        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(activeSessions.has(sessionId)).toBe(false);
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);
    });

    test('e) control.endSession se llama una única vez (idempotencia)', async () => {
        const sessionId = 'session-idempotent';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-1',
            control: mockControl,
            createdAt: now,
            lastActivityAt: now
        });

        const p1 = closeSession(sessionId, 'first');
        const p2 = closeSession(sessionId, 'second');

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(r1).toBe(true);
        expect(r2).toBe(false);
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);
    });

    test('f) negociación timeout después de control creado => endSession se llama una vez', async () => {
        // Force startRTCSignalingSession to resolve mockControl, but make negotiation timeout
        jest.useFakeTimers();

        mockScrypted.mediaManager.convertMediaObject = jest.fn().mockResolvedValue({
            startRTCSignalingSession: jest.fn().mockImplementation(async () => {
                return mockControl;
            })
        });

        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-1' },
            body: { offer: 'mock-offer-sdp' }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        const negotiatePromise = negotiateHandler(req, res);

        // Advance timers by 15 seconds asynchronously to trigger WebRTC negotiation timeout
        await jest.advanceTimersByTimeAsync(15500);

        await negotiatePromise;

        expect(status).toBe(500);
        expect(body.error).toBe('WebRTC negotiation failed');
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);

        jest.useRealTimers();
    });

    test('g) control ausente => error claro, sin sessionId', async () => {
        // Return null from startRTCSignalingSession
        mockScrypted.mediaManager.convertMediaObject = jest.fn().mockResolvedValue({
            startRTCSignalingSession: jest.fn().mockResolvedValue(null)
        });

        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-1' },
            body: { offer: 'mock-offer-sdp' }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        await negotiateHandler(req, res);

        expect(status).toBe(500);
        expect(body.error).toBe('Scrypted runtime did not return RTCSessionControl');
    });

    test('h) answer exitoso => timeout se limpia', async () => {
        jest.useFakeTimers();

        const fakeTimerClear = jest.spyOn(global, 'clearTimeout');

        // Mock signalingChannel to simulate successful answer sdp
        mockScrypted.mediaManager.convertMediaObject = jest.fn().mockResolvedValue({
            startRTCSignalingSession: jest.fn().mockImplementation(async (session) => {
                // Call setRemoteDescription immediately using macro-task queue
                setTimeout(() => {
                    session.setRemoteDescription({ sdp: 'mock-answer-sdp' }, {});
                }, 100);
                return mockControl;
            })
        });

        let status = 200;
        let body: any = null;
        const req: any = {
            params: { id: 'cam-1' },
            body: { offer: 'mock-offer-sdp' }
        };
        const res: any = {
            status: (s: number) => { status = s; return res; },
            json: (b: any) => { body = b; }
        };

        const negotiatePromise = negotiateHandler(req, res);

        // Advance timers by 200ms asynchronously to let setTimeout trigger
        await jest.advanceTimersByTimeAsync(200);

        await negotiatePromise;

        expect(status).toBe(200);
        expect(body.answer).toBe('mock-answer-sdp');
        expect(fakeTimerClear).toHaveBeenCalled();

        jest.useRealTimers();
    });
});
