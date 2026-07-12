import { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack, RtpPacket } from 'werift';
import dgram from 'dgram';
import { randomUUID } from 'crypto';
import os from 'os';
import { CameraService } from '../../api/camera-service';
import { CameraProbe } from '../../api/camera-probe';
import { PreviewService } from '../preview-service';
import { MediaSourceSessionManager } from '../media-session-manager';

export type WebRTCState =
    | 'idle'
    | 'validating_source'
    | 'offer_received'
    | 'answer_created'
    | 'ice_candidate_gathering'
    | 'ice_checking'
    | 'ice_connected'
    | 'rtp_receiving'
    | 'first_frame'
    | 'failed'
    | 'closed';

const ICE_PORT_MIN = 50000;
const ICE_PORT_MAX = 50050;

export class WebRTCSessionManager {
    private sessions = new Map<string, {
        pc: RTCPeerConnection;
        track: MediaStreamTrack;
        rtpSocket: dgram.Socket;
        rtcpSocket: dgram.Socket;
        rtpPort: number;
        rtcpPort: number;
        ffProcess?: any;
        state: WebRTCState;
        watchdog: NodeJS.Timeout;
        cameraId: string;
        startTime: number;
    }>();

    constructor(
        private readonly cameraService: CameraService,
        private readonly previewService: PreviewService,
        private readonly sessionManager: MediaSourceSessionManager
    ) {}

    private log(sessionId: string, event: string, details?: Record<string, unknown>) {
        const session = this.sessions.get(sessionId);
        const duration = session ? Date.now() - session.startTime : 0;
        // Never log full IP addresses or credentials in persistent logs.
        // Only log candidate type, port, and result.
        console.log(`[WebRTC] [${sessionId.slice(0, 8)}] [${event}] [${duration}ms]`,
            details ? JSON.stringify(details) : '');
    }

    private transition(sessionId: string, newState: WebRTCState, details?: Record<string, unknown>) {
        const session = this.sessions.get(sessionId);
        if (session && session.state !== 'closed' && session.state !== 'failed') {
            session.state = newState;
            this.log(sessionId, 'state_changed', { state: newState, ...details });
        }
    }

    private setWatchdog(sessionId: string, ms: number, failureReason: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            clearTimeout(session.watchdog);
            session.watchdog = setTimeout(() => {
                this.failSession(sessionId, failureReason);
            }, ms);
        }
    }

    /**
     * Returns the LAN IP addresses that are reachable from the local network.
     * Excludes loopback (127.x.x.x), internal Docker bridge (172.30.x.x), and IPv6.
     * The LAN IP (e.g. 192.168.x.x) IS necessary and must be announced to the browser.
     */
    private getLanIpAddresses(): string[] {
        const result: string[] = [];
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of (nets[name] ?? [])) {
                if (net.family === 'IPv4' && !net.internal
                    && !net.address.startsWith('172.30.')
                    && !net.address.startsWith('127.')) {
                    result.push(net.address);
                }
            }
        }
        return result;
    }

    /**
     * Finds a free RTP/RTCP port pair within [ICE_PORT_MIN, ICE_PORT_MAX].
     * Binds the pair and returns the sockets + ports. Throws if no pair is available.
     */
    private async allocateRtpSocketPair(): Promise<{
        rtpSocket: dgram.Socket;
        rtcpSocket: dgram.Socket;
        rtpPort: number;
        rtcpPort: number;
    }> {
        for (let port = ICE_PORT_MIN; port < ICE_PORT_MAX; port += 2) {
            const rtpSocket = dgram.createSocket('udp4');
            const rtcpSocket = dgram.createSocket('udp4');

            try {
                await new Promise<void>((resolve, reject) => {
                    rtpSocket.once('error', reject);
                    rtpSocket.bind(port, '127.0.0.1', () => {
                        rtpSocket.removeAllListeners('error');
                        resolve();
                    });
                });

                await new Promise<void>((resolve, reject) => {
                    rtcpSocket.once('error', (err) => {
                        rtpSocket.close();
                        reject(err);
                    });
                    rtcpSocket.bind(port + 1, '127.0.0.1', () => {
                        rtcpSocket.removeAllListeners('error');
                        resolve();
                    });
                });

                return { rtpSocket, rtcpSocket, rtpPort: port, rtcpPort: port + 1 };
            } catch {
                try { rtpSocket.close(); } catch {}
                try { rtcpSocket.close(); } catch {}
                // Try next pair
            }
        }
        throw new Error(`No hay ningún par RTP/RTCP libre en el rango ${ICE_PORT_MIN}-${ICE_PORT_MAX}`);
    }

    async createOffer(
        cameraId: string,
        offer: { sdp: string; type: 'offer' | 'pranswer' | 'answer' | 'rollback' },
        cameraProbe: CameraProbe
    ) {
        const sessionId = randomUUID();
        const startTime = Date.now();

        this.log(sessionId, 'webrtc.offer.received', { cameraId });

        // 1. Validate that a reachable LAN IP exists on the host.
        // The LAN IP (e.g. 192.168.110.147) IS needed for WebRTC local connectivity.
        // We only reject if the only addresses are internal/unreachable (172.30.x.x, 127.x).
        const lanIps = this.getLanIpAddresses();
        if (lanIps.length === 0) {
            this.log(sessionId, 'webrtc.failed', { reason: 'ICE_CANDIDATE_UNREACHABLE' });
            const err: any = new Error('No se encontró IP LAN alcanzable en el host (solo 172.30.x.x o loopback).');
            err.code = 'ICE_CANDIDATE_UNREACHABLE';
            throw err;
        }
        this.log(sessionId, 'webrtc.ice.candidate_gathering', { count: lanIps.length });

        // 2. Validate camera source before opening any WebRTC resources.
        let source;
        try {
            source = await this.previewService.resolveProfile(cameraId, cameraProbe);
        } catch (err: any) {
            this.log(sessionId, 'webrtc.failed', { reason: 'CAMERA_SOURCE_UNAVAILABLE' });
            const e: any = new Error(err.message);
            e.code = 'CAMERA_SOURCE_UNAVAILABLE';
            throw e;
        }
        this.log(sessionId, 'webrtc.source.validated', { profileId: source.descriptor.id });

        // 3. Allocate one RTP/RTCP port pair dynamically for this session.
        let sockets;
        try {
            sockets = await this.allocateRtpSocketPair();
        } catch (err: any) {
            this.log(sessionId, 'webrtc.failed', { reason: 'PORT_EXHAUSTED' });
            const e: any = new Error(err.message);
            e.code = 'ICE_CANDIDATE_UNREACHABLE';
            throw e;
        }
        const { rtpSocket, rtcpSocket, rtpPort, rtcpPort } = sockets;
        this.log(sessionId, 'webrtc.rtp.ports_allocated', { rtpPort, rtcpPort });

        // 4. Create RTCPeerConnection.
        // Werift uses icePortRange for its own ICE UDP sockets and iceAdditionalHostAddresses
        // to ensure LAN addresses are included in ICE candidates.
        // We do NOT rewrite the SDP text manually — Werift generates valid candidates.
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            icePortRange: [ICE_PORT_MIN, ICE_PORT_MAX] as [number, number],
            iceAdditionalHostAddresses: lanIps,
        });

        const track = new MediaStreamTrack({
            kind: 'video',
            codec: new RTCRtpCodecParameters({
                mimeType: 'video/H264',
                clockRate: 90000,
                payloadType: 96,
                rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }],
            }),
        });

        pc.addTrack(track);

        this.sessions.set(sessionId, {
            pc, track, rtpSocket, rtcpSocket, rtpPort, rtcpPort,
            state: 'offer_received',
            watchdog: setTimeout(() => {}, 0),
            cameraId,
            startTime,
        });

        // 5. ICE watchdog: 15 seconds to reach connected.
        this.setWatchdog(sessionId, 15000, 'ICE connection timeout after 15s');

        pc.iceGatheringStateChange.subscribe((state) => {
            if (state === 'gathering') {
                this.transition(sessionId, 'ice_candidate_gathering');
            }
        });

        pc.connectionStateChange.subscribe((state) => {
            if (state === 'connecting') {
                this.transition(sessionId, 'ice_checking');
                this.log(sessionId, 'webrtc.ice.checking');
            } else if (state === 'connected') {
                this.transition(sessionId, 'ice_connected');
                this.log(sessionId, 'webrtc.ice.connected');

                // Switch to RTP watchdog: 10 seconds.
                this.setWatchdog(sessionId, 10000, 'RTP receive timeout after 10s');

                this.startFFmpeg(cameraId, rtpPort, rtcpPort, sessionId, source.descriptor.id)
                    .catch(err => this.failSession(sessionId, 'FFmpeg start failed: ' + err.message));
            } else if (state === 'failed' || state === 'closed' || state === 'disconnected') {
                this.failSession(sessionId, `ICE state: ${state}`);
            }
        });

        // 6. Forward RTP packets from FFmpeg's local UDP socket → Werift track.
        let firstPacketReceived = false;
        rtpSocket.on('message', (msg) => {
            if (pc.connectionState === 'connected' && msg.length >= 12) {
                try {
                    const packet = RtpPacket.deSerialize(msg);
                    packet.header.payloadType = 96;

                    if (!firstPacketReceived) {
                        firstPacketReceived = true;
                        this.transition(sessionId, 'rtp_receiving');
                        this.log(sessionId, 'webrtc.rtp.first_packet', { rtpPort });
                        // Switch to first-frame watchdog: 10 seconds.
                        this.setWatchdog(sessionId, 10000, 'First frame timeout after 10s');
                    }

                    track.writeRtp(packet.serialize());
                } catch {
                    // Discard malformed packets silently.
                }
            }
        });

        // 7. Negotiate SDP. Werift generates ICE candidates based on its config.
        // We do NOT alter SDP text — candidates are determined by Werift's configuration above.
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.transition(sessionId, 'answer_created');
        this.log(sessionId, 'webrtc.answer.created');

        return {
            sessionId,
            sdp: pc.localDescription?.sdp ?? '',
            type: pc.localDescription?.type ?? 'answer',
            codec: 'H264',
        };
    }

    async addIceCandidate(sessionId: string, candidate: any) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found or expired');
        // end-of-candidates is signaled by an empty candidate — do NOT close the session.
        if (!candidate?.candidate) return;
        await session.pc.addIceCandidate(candidate);
    }

    async confirmFirstFrame(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session && session.state !== 'failed' && session.state !== 'closed') {
            clearTimeout(session.watchdog);
            this.transition(sessionId, 'first_frame');
            this.log(sessionId, 'webrtc.first_frame.browser');
        }
    }

    private async startFFmpeg(
        cameraId: string, rtpPort: number, rtcpPort: number,
        sessionId: string, sourceId: string
    ) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        await this.sessionManager.executeWithSourceRetry(cameraId, sourceId, async (input, sig) => {
            const args = [
                '-hide_banner', '-loglevel', 'error',
                ...input.ffmpegInputArguments,
                '-map', '0:v:0',
                '-c:v', 'copy',
                '-payload_type', '96',
                '-f', 'rtp',
                `rtp://127.0.0.1:${rtpPort}?rtcpport=${rtcpPort}`,
            ];

            const { process: ff, promise } = this.previewService.runner.spawnStreaming({
                command: 'ffmpeg',
                args,
                signal: sig,
                inputStream: input.inputStream,
                inputBuffer: input.inputBuffer,
            });

            session.ffProcess = ff;
            promise
                .then(() => this.stopSession(sessionId))
                .catch(() => this.stopSession(sessionId));
        });
    }

    private failSession(sessionId: string, reason: string) {
        const session = this.sessions.get(sessionId);
        if (session && session.state !== 'failed' && session.state !== 'closed') {
            session.state = 'failed';
            this.log(sessionId, 'webrtc.failed', { reason });
            this.stopSession(sessionId);
        }
    }

    stopSession(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (session) {
            clearTimeout(session.watchdog);
            if (session.state !== 'failed') {
                session.state = 'closed';
                this.log(sessionId, 'webrtc.closed');
            }
            try { session.pc.close(); } catch {}
            try { session.rtpSocket.close(); } catch {}
            try { session.rtcpSocket.close(); } catch {}
            if (session.ffProcess && !session.ffProcess.killed) {
                session.ffProcess.kill('SIGTERM');
            }
            this.sessions.delete(sessionId);
        }
    }
}
