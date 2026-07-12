import fs from 'node:fs';
import net from 'node:net';
import { MatterRuntimeHost } from './matter-runtime-host.js';

async function main() {
    console.log('Iniciando Scryvex Matterbridge Host (s6-rc)...');
    
    const matterHome = process.env.MATTERBRIDGE_HOME || '/data/scryvex-matter';
    if (!fs.existsSync(matterHome)) {
        fs.mkdirSync(matterHome, { recursive: true });
    }

    try {
        const { Environment } = await import('matterbridge/matter');
        // Set default storage location for Matter
        const env = Environment.default;
        env.vars.set('storage.path', matterHome);
    } catch (err) {
        console.error('[Scryvex Matter] Error cargando matterbridge/matter. Entrando en estado idle:', err);
        // Idle loop to prevent crash loop in s6-rc
        setInterval(() => {}, 60000);
        return;
    }

    const host = new MatterRuntimeHost(matterHome);
    await host.initialize();

    const SOCKET_PATH = '/run/scryvex-matter.sock';
    if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
    }

    const server = net.createServer((socket) => {
        socket.on('data', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                host.handleMessage(msg, socket).catch(err => {
                    console.error('[Scryvex Matter] Error handleMessage:', err);
                    socket.write(JSON.stringify({ error: err.message }) + '\n');
                });
            } catch (err) {
                console.error('[Scryvex Matter] Invalid IPC data:', err);
            }
        });
    });

    server.listen(SOCKET_PATH, () => {
        fs.chmodSync(SOCKET_PATH, 0o666);
        console.log(`[Scryvex Matter] Escuchando en IPC ${SOCKET_PATH}`);
    });

    // Clean shutdown
    let shuttingDown = false;
    process.on('SIGTERM', async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('[Scryvex Matter] Recibido SIGTERM, cerrando limpiamente...');
        
        server.close();
        try {
            await host.destroy();
            console.log('[Scryvex Matter] Apagado completo.');
            process.exit(0);
        } catch (e) {
            console.error('[Scryvex Matter] Error durante apagado:', e);
            process.exit(1);
        }
    });
}

main().catch(err => {
    console.error('Error fatal en Scryvex Matter:', err);
    process.exit(1);
});
