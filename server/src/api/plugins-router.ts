import { Router } from 'express';
import { Pool } from 'pg';

export function createPluginsRouter(pool: Pool, scrypted: any): Router {
    const router = Router();

    const npmPackageMap: Record<string, string> = {
        rtsp: '@scrypted/rtsp',
        onvif: '@scrypted/onvif',
        ring: '@scrypted/ring',
        wyze: '@scrypted/wyze',
        tapo: '@scrypted/tapo',
        tuya: '@scrypted/tuya',
        ezviz: '@scrypted/ezviz',
        hikvision: '@scrypted/hikvision',
        reolink: '@scrypted/reolink',
        dahua: '@scrypted/dahua',
        'google-nest': '@scrypted/google-device-access',
        arlo: '@scrypted/arlo',
        homekit: '@scrypted/homekit',
        webrtc: '@scrypted/webrtc',
    };

    const RECOMMENDED_PLUGINS = [
        { id: 'onvif',       name: 'ONVIF Profile S/T', protocol: 'ONVIF',  description: 'Descubrimiento y control PTZ/Hardware vía ONVIF.',                  version: '1.0.0', icon: '/logos/onvif.png' },
        { id: 'rtsp',        name: 'RTSP Camera',       protocol: 'RTSP',   description: 'Conecta cámaras RTSP locales con el plugin original.',            version: '1.0.0', icon: '/logos/rtsp.png' },
        { id: 'webrtc',      name: 'WebRTC',            protocol: 'WebRTC', description: 'Pipeline original de streaming WebRTC de baja latencia.',        version: '1.0.0', icon: '/logos/webrtc.png' },
        { id: 'homekit',     name: 'HomeKit',           protocol: 'Apple',  description: 'Integración original con Apple HomeKit / HKSV.',                  version: '1.0.0', icon: '/logos/homekit.png' },
        { id: 'ring',        name: 'Ring',               protocol: 'Cloud',  description: 'Integración nativa con cámaras y timbres Ring.',                    version: '2.4.1', icon: '/logos/ring.png' },
        { id: 'wyze',        name: 'Wyze',               protocol: 'Cloud',  description: 'Integración con cámaras Wyze vía API oficial.',                     version: '1.8.0', icon: '/logos/wyze.png' },
        { id: 'tapo',        name: 'TP-Link Tapo',       protocol: 'Local',  description: 'Conexión local a cámaras Tapo y Kasa.',                             version: '2.0.1', icon: '/logos/tapo.jpg' },
        { id: 'tuya',        name: 'Tuya Smart',         protocol: 'Cloud',  description: 'Soporte para cámaras genéricas del ecosistema Tuya.',               version: '3.1.0', icon: '/logos/tuya.png' },
        { id: 'ezviz',       name: 'EZVIZ',              protocol: 'Cloud',  description: 'Conexión con cámaras EZVIZ.',                                       version: '1.5.2', icon: '/logos/ezviz.png' },
        { id: 'hikvision',   name: 'Hikvision',          protocol: 'Local',  description: 'Integración profunda con NVRs y cámaras Hikvision.',                version: '2.2.0', icon: '/logos/hikvision.png' },
        { id: 'reolink',     name: 'Reolink',            protocol: 'Local',  description: 'API local para cámaras Reolink con soporte IA.',                    version: '1.9.4', icon: '/logos/reolink.png' },
        { id: 'dahua',       name: 'Dahua',              protocol: 'Local',  description: 'API local para cámaras y NVRs Dahua.',                              version: '1.4.0', icon: '/logos/dahua.png' },
        { id: 'google-nest', name: 'Google Nest',        protocol: 'Cloud',  description: 'Soporte oficial Google Device Access Console (SDM).',               version: '2.0.0', icon: '/logos/google-nest.png' },
        { id: 'arlo',        name: 'Arlo',               protocol: 'Cloud',  description: 'Integración con cámaras inalámbricas Arlo.',                       version: '1.2.5', icon: '/logos/arlo.png' },
    ];

    // GET /api/plugins
    router.get('/', (_req, res) => {
        const installedPlugins = Object.keys(scrypted.plugins || {});
        const plugins = RECOMMENDED_PLUGINS.map(p => {
            const npmPkg = npmPackageMap[p.id];
            return {
                ...p,
                installed: installedPlugins.includes(npmPkg || ''),
            };
        });
        res.status(200).json({ plugins });
    });

    // POST /api/plugins/:id/install
    router.post('/:id/install', async (req, res) => {
        const npmPkg = npmPackageMap[req.params.id];
        if (!npmPkg) {
            res.status(404).json({ error: 'Plugin no soportado' });
            return;
        }

        try {
            console.log(`[PluginsRouter] Installing plugin: ${npmPkg}`);
            await scrypted.installNpm(npmPkg);
            res.json({ success: true, message: `Plugin ${req.params.id} instalado correctamente` });
        } catch (e: any) {
            console.error(`[PluginsRouter] Failed to install ${npmPkg}:`, e);
            res.status(500).json({ error: e.message || 'Failed to install plugin' });
        }
    });

    // DELETE /api/plugins/:id
    router.delete('/:id', async (req, res) => {
        const npmPkg = npmPackageMap[req.params.id];
        if (!npmPkg) {
            res.status(404).json({ error: 'Plugin no soportado' });
            return;
        }

        // Evitar desinstalar plugins esenciales de Scrypted Core
        if (req.params.id === 'webrtc') {
            res.status(400).json({ error: 'No se puede desinstalar el plugin WebRTC esencial.' });
            return;
        }

        try {
            const pluginDevice = scrypted.findPluginDevice(npmPkg);
            if (!pluginDevice) {
                res.status(404).json({ error: 'Plugin no instalado en el Runtime' });
                return;
            }
            console.log(`[PluginsRouter] Removing plugin device: ${npmPkg}`);
            await scrypted.removeDevice(pluginDevice);
            res.json({ success: true, message: `Plugin ${req.params.id} desinstalado` });
        } catch (e: any) {
            console.error(`[PluginsRouter] Failed to uninstall ${npmPkg}:`, e);
            res.status(500).json({ error: e.message || 'Failed to uninstall plugin' });
        }
    });

    return router;
}

