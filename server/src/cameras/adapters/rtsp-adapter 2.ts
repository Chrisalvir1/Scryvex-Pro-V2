import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CameraAdapter, CameraCapabilities, CameraConnectionInput, CameraDiscoveryResult, ConnectionTestResult, StreamProfile } from '../camera-adapter';
import { emptyCapabilities } from '../camera-adapter';

interface ProbeStream { codec_name?: string; codec_long_name?: string; width?: number; height?: number; r_frame_rate?: string; bit_rate?: string; sample_rate?: string; codec_type?: string; }

function runProbe(url: string): Promise<{ streams: ProbeStream[] }> {
    return new Promise((resolve, reject) => {
        const child = spawn('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', url], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
        child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout) as { streams: ProbeStream[] }) : reject(new Error(stderr || `ffprobe terminó con código ${code}`)));
    });
}

function fps(value?: string): number | undefined { if (!value) return undefined; const [n, d] = value.split('/').map(Number); return d ? (n ?? 0) / d : n; }

export class RtspAdapter implements CameraAdapter {
    readonly protocol = 'RTSP' as const;
    private async probe(input: CameraConnectionInput) { if (!input.rtsp_url) throw new Error('La cámara RTSP no tiene rtsp_url'); return runProbe(input.rtsp_url); }
    async discover(input: CameraConnectionInput): Promise<CameraDiscoveryResult> {
        const base = emptyCapabilities('rtsp');
        try {
            const result = await this.probe(input);
            const profiles: StreamProfile[] = result.streams.filter(s => s.codec_type === 'video').map((s, i) => ({ id: `rtsp-${i}`, name: i ? 'Video' : 'Principal', codec: s.codec_name?.toUpperCase(), width: s.width, height: s.height, fps: fps(s.r_frame_rate), bitrate: s.bit_rate ? Number(s.bit_rate) : undefined }));
            const audio = result.streams.filter(s => s.codec_type === 'audio');
            base.discoveryStatus = 'online'; base.lastCheckedAt = new Date().toISOString(); base.video.profiles = profiles; base.video.supportsH264 = profiles.some(p => p.codec === 'H264'); base.video.supportsH265 = profiles.some(p => p.codec === 'HEVC' || p.codec === 'H265'); base.video.selectedProfileId = profiles[0]?.id; base.audio.available = audio.length > 0; base.audio.codecs = audio.flatMap(s => s.codec_name ? [s.codec_name.toUpperCase()] : []); base.audio.sampleRates = audio.flatMap(s => s.sample_rate ? [Number(s.sample_rate)] : []); base.preview.rtsp = true;
            return { capabilities: base, streamProfiles: profiles };
        } catch (error) { base.discoveryStatus = 'error'; base.lastCheckedAt = new Date().toISOString(); throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { capabilities: base }); }
    }
    async getCapabilities(input: CameraConnectionInput) { return (await this.discover(input)).capabilities; }
    async testConnection(input: CameraConnectionInput): Promise<ConnectionTestResult> { try { await this.probe(input); return { success: true, status: 'online' }; } catch (error) { return { success: false, status: 'error', message: error instanceof Error ? error.message : String(error) }; } }
    async startPreview(_input: CameraConnectionInput) { return { sessionId: randomUUID() }; }
}
