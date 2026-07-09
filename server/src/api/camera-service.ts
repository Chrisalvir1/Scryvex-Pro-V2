import { Pool } from 'pg';
import { CameraStatus, CameraEvent, CreateCameraInput, CameraProtocol } from '../types/camera';
export { CameraStatus, CameraEvent, CreateCameraInput, CameraProtocol };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Camera {
    id: string;          // UUID
    name: string;
    ip: string;
    port: number;
    rtsp_url?: string;
    onvif_port?: number;
    username?: string;
    password_hash?: string;  // AES-256 encrypted, never plaintext
    protocol: CameraProtocol;
    status: CameraStatus;
    codec?: string;          // e.g. "H.265", "H.264"
    config: Record<string, unknown>;  // JSONB: matter, yolo, etc.
    
    // HKSV Specifics
    hksv_codecs?: string[];
    hksv_video_tiers?: Record<string, unknown>;
    hksv_audio_codec?: string;
    hksv_audio_samplerate?: number;
    hksv_capabilities?: Record<string, unknown>;
    hksv_motion_zones?: Record<string, unknown>;

    // Matter Configuration
    matter_vendor_id?: number;
    matter_product_id?: number;
    matter_device_name?: string;

    created_at: Date;
    updated_at: Date;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CameraService {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    /**
     * Creates the cameras and camera_events tables if they don't exist.
     * Called once on server startup.
     */
    async migrate(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS scryvex_core.cameras (
                id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name         TEXT NOT NULL,
                ip           TEXT NOT NULL,
                port         INTEGER NOT NULL DEFAULT 554,
                rtsp_url     TEXT,
                onvif_port   INTEGER,
                username     TEXT,
                password_hash TEXT,
                protocol     TEXT NOT NULL DEFAULT 'RTSP',
                status       TEXT NOT NULL DEFAULT 'unknown',
                codec        TEXT,
                config       JSONB NOT NULL DEFAULT '{}',
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS scryvex_core.camera_events (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                camera_id   UUID NOT NULL REFERENCES scryvex_core.cameras(id) ON DELETE CASCADE,
                event_type  TEXT NOT NULL,
                timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                metadata    JSONB NOT NULL DEFAULT '{}'
            );
        `);

        // Index for fast event queries per camera
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_camera_events_camera_id
            ON scryvex_core.camera_events(camera_id, timestamp DESC);
        `);

        // HKSV Migrations
        await this.pool.query(`
            ALTER TABLE scryvex_core.cameras 
            ADD COLUMN IF NOT EXISTS hksv_codecs TEXT[] DEFAULT '{"H.264", "H.265"}',
            ADD COLUMN IF NOT EXISTS hksv_video_tiers JSONB DEFAULT '{"High": {"TargetAverageBitrate": 1700, "Quality": 2, "Width": 1920, "Height": 1080, "FrameRate": 30}, "Medium": {"TargetAverageBitrate": 768, "Quality": 3, "Width": 1280, "Height": 720, "FrameRate": 30}, "Low": {"TargetAverageBitrate": 180, "Quality": 4, "Width": 640, "Height": 360, "FrameRate": 15}}',
            ADD COLUMN IF NOT EXISTS hksv_audio_codec TEXT DEFAULT 'Opus',
            ADD COLUMN IF NOT EXISTS hksv_audio_samplerate INTEGER DEFAULT 16,
            ADD COLUMN IF NOT EXISTS hksv_capabilities JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS hksv_motion_zones JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS matter_vendor_id INTEGER DEFAULT 4939,
            ADD COLUMN IF NOT EXISTS matter_product_id INTEGER DEFAULT 2049,
            ADD COLUMN IF NOT EXISTS matter_device_name TEXT;

        -- Remove old HAP columns if they exist (Migration to Matter)
        ALTER TABLE scryvex_core.cameras DROP COLUMN IF EXISTS hap_setup_uri;
        ALTER TABLE scryvex_core.cameras DROP COLUMN IF EXISTS hap_pincode;
        `);

        console.log('[CameraService] Database tables ready.');
    }

    // ── Cameras CRUD ───────────────────────────────────────────────────────────

    async findAll(): Promise<Camera[]> {
        const res = await this.pool.query<Camera>(`
            SELECT id, name, ip, port, rtsp_url, onvif_port, username,
                   protocol, status, codec, config, 
                   hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones,
                   matter_vendor_id, matter_product_id, matter_device_name,
                   created_at, updated_at
            FROM scryvex_core.cameras
            ORDER BY created_at ASC
        `);
        return res.rows;
    }

    async findById(id: string): Promise<Camera | undefined> {
        const res = await this.pool.query<Camera>(`
            SELECT id, name, ip, port, rtsp_url, onvif_port, username,
                   protocol, status, codec, config,
                   hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones,
                   matter_vendor_id, matter_product_id, matter_device_name,
                   created_at, updated_at
            FROM scryvex_core.cameras
            WHERE id = $1
        `, [id]);
        return res.rows[0];
    }

    async create(input: CreateCameraInput): Promise<Camera> {
        // Apply HKSV defaults if not provided in the input
        const defaultHksvVideoTiers = {
            "Highest": { "TargetAverageBitrate": 4500, "Quality": 1, "Width": 3840, "Height": 2160, "FrameRate": 30 },
            "High":    { "TargetAverageBitrate": 1700, "Quality": 2, "Width": 1920, "Height": 1080, "FrameRate": 30 },
            "Medium":  { "TargetAverageBitrate": 768,  "Quality": 3, "Width": 1280, "Height": 720,  "FrameRate": 30 },
            "Low":     { "TargetAverageBitrate": 180,  "Quality": 4, "Width": 640,  "Height": 360,  "FrameRate": 15 }
        };

        const res = await this.pool.query<Camera>(`
            INSERT INTO scryvex_core.cameras
                (name, ip, port, rtsp_url, onvif_port, username, password_hash,
                 protocol, codec, config, hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones,
                 matter_vendor_id, matter_product_id, matter_device_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING id, name, ip, port, rtsp_url, onvif_port, username,
                      protocol, status, codec, config,
                      hksv_codecs, hksv_video_tiers, hksv_audio_codec, hksv_audio_samplerate, hksv_capabilities, hksv_motion_zones,
                      matter_vendor_id, matter_product_id, matter_device_name,
                      created_at, updated_at
        `, [
            input.name,
            input.ip,
            input.port,
            input.rtsp_url   ?? null,
            input.onvif_port ?? null,
            input.username   ?? null,
            input.password   ?? null,   // TODO: encrypt with AES-256 before storing
            input.protocol,
            input.codec      ?? null,
            JSON.stringify(input.config ?? {}),
            input.hksv_codecs ?? ['H.264', 'H.265'],
            JSON.stringify(input.hksv_video_tiers ?? defaultHksvVideoTiers),
            input.hksv_audio_codec ?? 'Opus',
            input.hksv_audio_samplerate ?? 16,
            JSON.stringify(input.hksv_capabilities ?? {}),
            JSON.stringify(input.hksv_motion_zones ?? {}),
            input.matter_vendor_id ?? 4939,
            input.matter_product_id ?? 2049,
            input.matter_device_name ?? input.name
        ]);
        
        return res.rows[0]!;
    }

    async updateStatus(id: string, status: CameraStatus): Promise<void> {
        await this.pool.query(`
            UPDATE scryvex_core.cameras
            SET status = $1, updated_at = NOW()
            WHERE id = $2
        `, [status, id]);
    }

    async delete(id: string): Promise<boolean> {
        const res = await this.pool.query(`
            DELETE FROM scryvex_core.cameras WHERE id = $1
        `, [id]);
        return (res.rowCount ?? 0) > 0;
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    async recordEvent(
        camera_id: string,
        event_type: CameraEvent['event_type'],
        metadata: Record<string, unknown> = {}
    ): Promise<CameraEvent> {
        const res = await this.pool.query<CameraEvent>(`
            INSERT INTO scryvex_core.camera_events (camera_id, event_type, metadata)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [camera_id, event_type, JSON.stringify(metadata)]);

        // Also update camera status for online/offline events
        if (event_type === 'online' || event_type === 'offline') {
            await this.updateStatus(camera_id, event_type as CameraStatus);
        }

        return res.rows[0]!;
    }

    async getRecentEvents(camera_id: string, limit = 50): Promise<CameraEvent[]> {
        const res = await this.pool.query<CameraEvent>(`
            SELECT * FROM scryvex_core.camera_events
            WHERE camera_id = $1
            ORDER BY timestamp DESC
            LIMIT $2
        `, [camera_id, limit]);
        return res.rows;
    }
}
