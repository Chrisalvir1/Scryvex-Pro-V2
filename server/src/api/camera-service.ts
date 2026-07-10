import { Pool } from 'pg';
import { CameraStatus, CameraEvent, CreateCameraInput, CameraProtocol } from '../types/camera';
import type { CameraCapabilities, DiscoveryStatus, StreamProfile } from '../cameras/camera-adapter';
import { emptyCapabilities } from '../cameras/camera-adapter';
import type { CameraConnectionInput } from '../cameras/camera-adapter';
export { CameraStatus, CameraEvent, CreateCameraInput, CameraProtocol };

export interface Camera {
    id: string; name: string; ip: string; port: number; rtsp_url?: string; onvif_port?: number; username?: string; password_hash?: string; protocol: CameraProtocol; status: CameraStatus; codec?: string; config: Record<string, unknown>;
    hksv_codecs?: string[]; hksv_video_tiers?: Record<string, unknown>; hksv_audio_codec?: string; hksv_audio_samplerate?: number; hksv_capabilities?: Record<string, unknown>; hksv_motion_zones?: Record<string, unknown>; matter_vendor_id?: number; matter_product_id?: number; matter_device_name?: string;
    adapter_type?: CameraProtocol; discovery_status: DiscoveryStatus; capabilities: CameraCapabilities; stream_profiles: StreamProfile[]; last_probe_at?: Date; last_error?: string; created_at: Date; updated_at: Date;
}

export class CameraService {
    constructor(private readonly pool: Pool) {}

    async migrate(): Promise<void> {
        await this.pool.query(`CREATE SCHEMA IF NOT EXISTS scryvex_core`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scryvex_core.cameras (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 554, rtsp_url TEXT, onvif_port INTEGER, username TEXT, password_hash TEXT, protocol TEXT NOT NULL DEFAULT 'RTSP', status TEXT NOT NULL DEFAULT 'unknown', codec TEXT, config JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scryvex_core.camera_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), camera_id UUID NOT NULL REFERENCES scryvex_core.cameras(id) ON DELETE CASCADE, event_type TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata JSONB NOT NULL DEFAULT '{}')`);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_camera_events_camera_id ON scryvex_core.camera_events(camera_id, timestamp DESC)`);
        await this.pool.query(`ALTER TABLE scryvex_core.cameras ADD COLUMN IF NOT EXISTS hksv_codecs TEXT[], ADD COLUMN IF NOT EXISTS hksv_video_tiers JSONB, ADD COLUMN IF NOT EXISTS hksv_audio_codec TEXT, ADD COLUMN IF NOT EXISTS hksv_audio_samplerate INTEGER, ADD COLUMN IF NOT EXISTS hksv_capabilities JSONB DEFAULT '{}', ADD COLUMN IF NOT EXISTS hksv_motion_zones JSONB DEFAULT '{}', ADD COLUMN IF NOT EXISTS matter_vendor_id INTEGER, ADD COLUMN IF NOT EXISTS matter_product_id INTEGER, ADD COLUMN IF NOT EXISTS matter_device_name TEXT, ADD COLUMN IF NOT EXISTS adapter_type TEXT, ADD COLUMN IF NOT EXISTS discovery_status TEXT NOT NULL DEFAULT 'pending', ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS stream_profiles JSONB NOT NULL DEFAULT '[]', ADD COLUMN IF NOT EXISTS last_probe_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS last_error TEXT`);
        await this.pool.query(`CREATE TABLE IF NOT EXISTS scryvex_core.camera_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), camera_id UUID NOT NULL REFERENCES scryvex_core.cameras(id) ON DELETE CASCADE, event TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await this.pool.query(`UPDATE scryvex_core.cameras SET discovery_status = 'pending', last_error = NULL WHERE capabilities IS NULL OR capabilities = '{}'::jsonb`);
        console.log('[CameraService] Database tables ready.');
    }

    private readonly select = `id, name, ip, port, rtsp_url, onvif_port, username, protocol, status, codec, config, hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones, matter_vendor_id, matter_product_id, matter_device_name, adapter_type, discovery_status, capabilities, stream_profiles, last_probe_at, last_error, created_at, updated_at`;
    private normalize(camera: Camera): Camera { if (!camera.capabilities || Object.keys(camera.capabilities).length === 0) camera.capabilities = emptyCapabilities(camera.protocol === 'ONVIF' ? 'onvif' : camera.protocol === 'RTSP' ? 'rtsp' : 'integration'); if (!camera.stream_profiles) camera.stream_profiles = []; if (!camera.discovery_status) camera.discovery_status = 'pending'; return camera; }
    async findAll(): Promise<Camera[]> { return (await this.pool.query<Camera>(`SELECT ${this.select} FROM scryvex_core.cameras ORDER BY created_at ASC`)).rows.map(camera => this.normalize(camera)); }
    async findById(id: string): Promise<Camera | undefined> { const camera = (await this.pool.query<Camera>(`SELECT ${this.select} FROM scryvex_core.cameras WHERE id = $1`, [id])).rows[0]; return camera ? this.normalize(camera) : undefined; }
    async getConnectionInput(id: string): Promise<CameraConnectionInput | undefined> {
        const result = await this.pool.query<Camera & { password_hash?: string }>(`SELECT id, ip, port, onvif_port, rtsp_url, username, password_hash, config FROM scryvex_core.cameras WHERE id = $1`, [id]);
        const camera = result.rows[0];
        if (!camera) return undefined;
        // Existing installations currently store this field as the connection
        // secret. It is deliberately only selected for server-side adapters.
        return { id: camera.id, ip: camera.ip, port: camera.port, onvif_port: camera.onvif_port, rtsp_url: camera.rtsp_url, username: camera.username, password: camera.password_hash, config: camera.config };
    }

    async create(input: CreateCameraInput): Promise<Camera> {
        const result = await this.pool.query<Camera>(`INSERT INTO scryvex_core.cameras (name, ip, port, rtsp_url, onvif_port, username, password_hash, protocol, codec, config, hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones, matter_vendor_id, matter_product_id, matter_device_name, adapter_type, discovery_status, capabilities, stream_profiles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'pending','{}','[]') RETURNING ${this.select}`, [input.name, input.ip, input.port, input.rtsp_url ?? null, input.onvif_port ?? null, input.username ?? null, input.password ?? null, input.protocol, input.codec ?? null, JSON.stringify(input.config ?? {}), input.hksv_codecs ?? null, input.hksv_video_tiers ? JSON.stringify(input.hksv_video_tiers) : null, input.hksv_audio_codec ?? null, input.hksv_audio_samplerate ?? null, JSON.stringify(input.hksv_capabilities ?? {}), JSON.stringify(input.hksv_motion_zones ?? {}), input.matter_vendor_id ?? null, input.matter_product_id ?? null, input.matter_device_name ?? null, input.protocol]);
        return result.rows[0]!;
    }
    async updateStatus(id: string, status: CameraStatus) { await this.pool.query(`UPDATE scryvex_core.cameras SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]); }
    async updateDiscovery(id: string, status: DiscoveryStatus, capabilities?: CameraCapabilities, profiles?: StreamProfile[], error?: string) { await this.pool.query(`UPDATE scryvex_core.cameras SET discovery_status=$1, capabilities=COALESCE($2, capabilities), stream_profiles=COALESCE($3, stream_profiles), last_probe_at=NOW(), last_error=$4, status=CASE WHEN $1='online' THEN 'online' WHEN $1 IN ('offline','error','authentication_failed') THEN 'offline' ELSE status END, updated_at=NOW() WHERE id=$5`, [status, capabilities ? JSON.stringify(capabilities) : null, profiles ? JSON.stringify(profiles) : null, error ?? null, id]); }
    async updateConfig(id: string, partialConfig: Record<string, unknown>) {
        await this.pool.query(`UPDATE scryvex_core.cameras SET config = config || $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(partialConfig), id]);
    }
    async delete(id: string) { return ((await this.pool.query(`DELETE FROM scryvex_core.cameras WHERE id = $1`, [id])).rowCount ?? 0) > 0; }
    async recordEvent(camera_id: string, event_type: CameraEvent['event_type'], metadata: Record<string, unknown> = {}) { const result = await this.pool.query<CameraEvent>(`INSERT INTO scryvex_core.camera_events (camera_id,event_type,metadata) VALUES ($1,$2,$3) RETURNING *`, [camera_id, event_type, JSON.stringify(metadata)]); if (event_type === 'online' || event_type === 'offline') await this.updateStatus(camera_id, event_type); return result.rows[0]!; }
    async getRecentEvents(camera_id: string, limit = 50) { return (await this.pool.query<CameraEvent>(`SELECT * FROM scryvex_core.camera_events WHERE camera_id=$1 ORDER BY timestamp DESC LIMIT $2`, [camera_id, limit])).rows; }
    async recordLog(cameraId: string, event: string, metadata: Record<string, unknown> = {}) { await this.pool.query(`INSERT INTO scryvex_core.camera_logs (camera_id,event,metadata) VALUES ($1,$2,$3)`, [cameraId, event, JSON.stringify(metadata)]); }
    async getLogs(cameraId: string, limit = 200) { return (await this.pool.query(`SELECT * FROM scryvex_core.camera_logs WHERE camera_id=$1 ORDER BY created_at DESC LIMIT $2`, [cameraId, limit])).rows; }
    async clearLogs(cameraId: string) { await this.pool.query(`DELETE FROM scryvex_core.camera_logs WHERE camera_id=$1`, [cameraId]); }
    async selectStreamProfile(cameraId: string, profileId: string) { const camera = await this.findById(cameraId); const profile = camera?.capabilities.video.profiles.find(item => item.id === profileId); if (!camera || !profile) throw new Error('El perfil de video no fue detectado por la cámara'); await this.pool.query(`UPDATE scryvex_core.cameras SET capabilities=jsonb_set(capabilities, '{video,selectedProfileId}', to_jsonb($1::text)), updated_at=NOW() WHERE id=$2`, [profileId, cameraId]); return profile; }
    async selectAudioProfile(cameraId: string, codec: string) { const camera = await this.findById(cameraId); if (!camera || !camera.capabilities.audio.codecs.includes(codec)) throw new Error('El codec de audio no fue detectado por la cámara'); await this.pool.query(`UPDATE scryvex_core.cameras SET capabilities=jsonb_set(capabilities, '{audio,selectedCodec}', to_jsonb($1::text)), updated_at=NOW() WHERE id=$2`, [codec, cameraId]); return codec; }
}
