import { Router } from 'express';
import { Pool } from 'pg';

export function createPluginsRouter(pool: Pool) {
    const router = Router();

    const AVAILABLE_PLUGINS = [
        { id: 'rtsp', name: 'RTSP Local', protocol: 'RTSP', description: 'Conecta cualquier cámara RTSP de red local.', version: '1.0.0', icon: '/assets/logos/rtsp.png', installed: true },
        { id: 'onvif', name: 'ONVIF Profile S/T', protocol: 'ONVIF', description: 'Descubrimiento y control PTZ/Hardware vía ONVIF.', version: '1.0.0', icon: '/assets/logos/onvif.png', installed: true },
        { id: 'ring', name: 'Ring', protocol: 'Cloud', description: 'Integración nativa con cámaras y timbres Ring.', version: '2.4.1', icon: '/assets/logos/ring.png', installed: false },
        { id: 'wyze', name: 'Wyze', protocol: 'Cloud', description: 'Integración con cámaras Wyze vía API oficial.', version: '1.8.0', icon: '/assets/logos/wyze.png', installed: false },
        { id: 'tapo', name: 'TP-Link Tapo', protocol: 'Local', description: 'Conexión local a cámaras Tapo y Kasa.', version: '2.0.1', icon: '/assets/logos/tapo.png', installed: false },
        { id: 'tuya', name: 'Tuya Smart', protocol: 'Cloud', description: 'Soporte para cámaras genéricas del ecosistema Tuya.', version: '3.1.0', icon: '/assets/logos/tuya.png', installed: false },
        { id: 'ezviz', name: 'EZVIZ', protocol: 'Cloud', description: 'Conexión con cámaras EZVIZ.', version: '1.5.2', icon: '/assets/logos/ezviz.png', installed: false },
        { id: 'hikvision', name: 'Hikvision', protocol: 'Local', description: 'Integración profunda con NVRs y cámaras Hikvision.', version: '2.2.0', icon: '/assets/logos/hikvision.png', installed: false },
        { id: 'reolink', name: 'Reolink', protocol: 'Local', description: 'API local para cámaras Reolink con soporte IA.', version: '1.9.4', icon: '/assets/logos/reolink.png', installed: false },
        { id: 'dahua', name: 'Dahua', protocol: 'Local', description: 'API local para cámaras y NVRs Dahua.', version: '1.4.0', icon: '/assets/logos/dahua.png', installed: false },
        { id: 'google-nest', name: 'Google Nest', protocol: 'Cloud', description: 'Soporte oficial Google Device Access Console (SDM).', version: '2.0.0', icon: '/assets/logos/google-nest.png', installed: false },
        { id: 'arlo', name: 'Arlo', protocol: 'Cloud', description: 'Integración con cámaras inalámbricas Arlo.', version: '1.2.5', icon: '/assets/logos/arlo.png', installed: false },
        { id: 'vimtag', name: 'Vimtag', protocol: 'Local', description: 'Soporte local para cámaras Vimtag.', version: '1.0.2', icon: '/assets/logos/vimtag.png', installed: false },
    ];

    // GET /api/plugins
    router.get('/', (req, res) => {
        // In a real scenario, installed status would be read from the DB or filesystem
        res.json(AVAILABLE_PLUGINS);
    });

    // POST /api/plugins/:id/install
    router.post('/:id/install', (req, res) => {
        const plugin = AVAILABLE_PLUGINS.find(p => p.id === req.params.id);
        if (!plugin) return res.status(404).json({ error: 'Plugin no encontrado' });
        
        // Mock installation process
        plugin.installed = true;
        res.json({ success: true, message: `Plugin ${plugin.name} instalado correctamente`, plugin });
    });

    // DELETE /api/plugins/:id
    router.delete('/:id', (req, res) => {
        const plugin = AVAILABLE_PLUGINS.find(p => p.id === req.params.id);
        if (!plugin) return res.status(404).json({ error: 'Plugin no encontrado' });
        
        // Cannot uninstall core plugins
        if (plugin.id === 'rtsp' || plugin.id === 'onvif') {
            return res.status(400).json({ error: 'No se pueden desinstalar los plugins core.' });
        }

        plugin.installed = false;
        res.json({ success: true, message: `Plugin ${plugin.name} desinstalado` });
    });

    return router;
}
