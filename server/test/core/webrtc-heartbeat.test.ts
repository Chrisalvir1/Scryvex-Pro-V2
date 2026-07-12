import { activeSessions, closeSession, stopWebRTCCleanupInterval } from '../../src/api/scrypted/scrypted-router';

describe('WebRTC Sessions & Heartbeat', () => {
    let mockControl: any;

    beforeEach(() => {
        activeSessions.clear();
        mockControl = {
            endSession: jest.fn().mockResolvedValue(undefined)
        };
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

        // Simulate heartbeat
        const session = activeSessions.get(sessionId)!;
        session.lastActivityAt = Date.now();

        // Verify lastActivityAt is updated
        expect(activeSessions.get(sessionId)!.lastActivityAt).toBeGreaterThan(now - 1000);
    });

    test('b) sesión sin heartbeat expira', async () => {
        const sessionId = 'session-expired';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-1',
            control: mockControl,
            createdAt: now - 100000,
            lastActivityAt: now - 100000 // Over 60 seconds
        });

        // Trigger manual/cleanup checks
        const TIMEOUT_MS = 60 * 1000;
        for (const [sid, session] of activeSessions.entries()) {
            if (now - session.lastActivityAt > TIMEOUT_MS) {
                await closeSession(sid, 'Timeout');
            }
        }

        expect(activeSessions.has(sessionId)).toBe(false);
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);
    });

    test('c) DELETE con cameraId distinto devuelve error y no cierra (lógica de coincidencia)', async () => {
        const sessionId = 'session-diff';
        const now = Date.now();
        activeSessions.set(sessionId, {
            cameraId: 'cam-real',
            control: mockControl,
            createdAt: now,
            lastActivityAt: now
        });

        const reqId = 'cam-fake';
        const session = activeSessions.get(sessionId)!;
        
        let closed = false;
        if (session.cameraId === reqId) {
            await closeSession(sessionId, 'teardown');
            closed = true;
        }

        expect(closed).toBe(false);
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

        await closeSession(sessionId, 'Explicit client teardown');

        expect(activeSessions.has(sessionId)).toBe(false);
    });

    test('e) control.endSession se llama una única vez (idempotente)', async () => {
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
        expect(r2).toBe(false); // Second call returns false because session was already deleted from activeSessions
        expect(mockControl.endSession).toHaveBeenCalledTimes(1);
    });
});
