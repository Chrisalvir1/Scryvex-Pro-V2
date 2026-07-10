import { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { CameraService, CameraEvent } from './camera-service';

export type NodeHttpServer = HttpServer | HttpsServer;

interface WsClient {
    ws: WebSocket;
    subscriptions: Set<string>;  // set of camera IDs, or '*' for all
}

interface WsMessage {
    type: 'subscribe' | 'unsubscribe' | 'ping';
    camera_id?: string | '*';
}

interface WsEvent {
    type: 'camera_event' | 'camera_list_updated' | 'pong' | 'error' | 'cameras.updated';
    payload: unknown;
}

/**
 * WebSocket bridge for real-time camera events.
 * Clients connect to ws://host/api/ws/cameras
 *
 * Protocol (client → server):
 *   { type: 'subscribe', camera_id: '*' }         → all cameras
 *   { type: 'subscribe', camera_id: '<uuid>' }    → specific camera
 *   { type: 'unsubscribe', camera_id: '<uuid>' }
 *   { type: 'ping' }                              → keepalive
 *
 * Protocol (server → client):
 *   { type: 'camera_event', payload: CameraEvent }
 *   { type: 'camera_list_updated' }              → tells client to re-fetch via REST
 *   { type: 'pong' }
 *   { type: 'error', payload: { message } }
 */
export class CamerasWebSocketBridge {
    private wss: WebSocketServer;
    private clients: Set<WsClient> = new Set();
    private cameraService: CameraService;

    constructor(cameraService: CameraService) {
        this.cameraService = cameraService;
        this.wss = new WebSocketServer({ noServer: true });

        this.wss.on('connection', (ws: WebSocket) => {
            const client: WsClient = { ws, subscriptions: new Set(['*']) };
            this.clients.add(client);
            console.log(`[CamerasWS] Client connected (${this.clients.size} total)`);

            ws.on('message', (raw) => {
                try {
                    const msg = JSON.parse(raw.toString()) as WsMessage;
                    this.handleClientMessage(client, msg);
                } catch {
                    this.send(client, { type: 'error', payload: { message: 'Invalid JSON' } });
                }
            });

            ws.on('close', () => {
                this.clients.delete(client);
                console.log(`[CamerasWS] Client disconnected (${this.clients.size} remaining)`);
            });

            ws.on('error', (err) => {
                console.warn('[CamerasWS] Client error:', err.message);
                this.clients.delete(client);
            });
        });
    }

    /**
     * Attaches the WebSocket server upgrade handler to an HTTP/HTTPS server.
     */
    attachServer(server: NodeHttpServer) {
        const WS_PATH = '/api/ws/cameras';
        
        server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            const url = req.url ?? '';
            console.info('[CamerasWS] Upgrade request:', url);
            
            if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
                this.wss.handleUpgrade(req, socket, head, (ws) => {
                    this.wss.emit('connection', ws, req);
                });
            }
        });
    }

    private handleClientMessage(client: WsClient, msg: WsMessage) {
        switch (msg.type) {
            case 'ping':
                this.send(client, { type: 'pong', payload: null });
                break;
            case 'subscribe':
                if (msg.camera_id) {
                    client.subscriptions.add(msg.camera_id);
                }
                break;
            case 'unsubscribe':
                if (msg.camera_id) {
                    client.subscriptions.delete(msg.camera_id);
                }
                break;
        }
    }

    private send(client: WsClient, event: WsEvent) {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(event));
        }
    }

    /**
     * Broadcasts a camera event to all subscribed clients.
     * Call this from your stream controller / ONVIF event handler.
     */
    broadcastEvent(event: CameraEvent) {
        const payload: WsEvent = { type: 'camera_event', payload: event };
        const data = JSON.stringify(payload);

        for (const client of this.clients) {
            if (
                client.ws.readyState === WebSocket.OPEN &&
                (client.subscriptions.has('*') || client.subscriptions.has(event.camera_id))
            ) {
                client.ws.send(data);
            }
        }
    }

    /**
     * Notifies all clients that the camera list changed (camera added or removed).
     * Clients should re-fetch GET /api/cameras upon receiving this.
     */
    broadcastListUpdate() {
        const payload: WsEvent = { type: 'camera_list_updated', payload: null };
        const data = JSON.stringify(payload);
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(data);
            }
        }
    }

    /**
     * Notifies clients about specific camera updates (created, updated, deleted).
     */
    broadcastCamerasUpdated(reason: string, cameraId: string) {
        const payload: WsEvent = {
            type: 'cameras.updated',
            payload: {
                reason,
                cameraId
            }
        };
        const data = JSON.stringify(payload);
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(data);
            }
        }
    }

    get connectedClients(): number {
        return this.clients.size;
    }
}
