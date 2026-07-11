import { Router } from 'express';
import { SystemDiagnosticsService } from '../media/system-diagnostics';

export function createSystemRouter(): Router {
    const router = Router();
    const diagnosticsService = SystemDiagnosticsService.getInstance();

    // Middleware de seguridad estricto
    router.use((req, res, next) => {
        if (!res.locals.username) {
            res.status(401).json({ error: 'Not Authorized' });
            return;
        }
        next();
    });

    router.get('/media-capabilities', (req, res) => {
        const response = diagnosticsService.getResponse();
        res.json(response);
    });

    router.post('/media-capabilities/refresh', async (req, res) => {
        try {
            const response = await diagnosticsService.refresh();
            res.json(response);
        } catch (e: any) {
            res.status(500).json({ error: e.message || 'Internal Error' });
        }
    });

    return router;
}
