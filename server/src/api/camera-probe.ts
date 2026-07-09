import { Pool } from 'pg';

export class CameraProbe {
    constructor(private pool: Pool) {}

    async runProbe(cameraId: string) {
        console.log(`[CameraProbe] Running ffprobe analysis on camera ${cameraId}...`);
        
        // Mock FFprobe result
        const mockResult = {
            video_codec: 'H.265 / HEVC',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
            bit_rate: 2500000, // 2.5 Mbps
            audio_codec: 'AAC',
            audio_sample_rate: 16000,
            remux_h264: true,
            remux_h265: true, // "Crudo a HomeKit"
            hevc_enabled: true
        };

        // Update database with the probe data in the config JSONB column
        await this.pool.query(
            `UPDATE scryvex_core.cameras 
             SET config = jsonb_set(config, '{probe_data}', $1::jsonb) 
             WHERE id = $2`,
            [JSON.stringify(mockResult), cameraId]
        );

        return mockResult;
    }

    async getProbeData(cameraId: string) {
        const result = await this.pool.query(
            `SELECT config->'probe_data' as probe_data FROM scryvex_core.cameras WHERE id = $1`,
            [cameraId]
        );
        return result.rows[0]?.probe_data || null;
    }

    async toggleHEVC(cameraId: string, enabled: boolean) {
        const current = await this.getProbeData(cameraId);
        if (!current) return null;
        
        current.hevc_enabled = enabled;
        // In a real scenario, this would send an ONVIF/API command to the camera to switch profile
        
        await this.pool.query(
            `UPDATE scryvex_core.cameras 
             SET config = jsonb_set(config, '{probe_data}', $1::jsonb) 
             WHERE id = $2`,
            [JSON.stringify(current), cameraId]
        );
        return current;
    }
}
