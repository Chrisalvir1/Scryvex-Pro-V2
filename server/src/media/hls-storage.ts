import fs from 'fs';
import path from 'path';

export class HlsTempStorageSelector {
    private readonly root: string;
    private readonly maxBytesPerProducer = 32 * 1024 * 1024; // 32 MB

    constructor() {
        if (process.env.HLS_TEMP_ROOT) {
            this.root = process.env.HLS_TEMP_ROOT;
        } else {
            const shm = '/dev/shm';
            let useShm = false;
            try {
                if (fs.existsSync(shm)) {
                    // Check if it's writable
                    fs.accessSync(shm, fs.constants.W_OK);
                    useShm = true;
                }
            } catch (e) {
                // Ignore
            }
            this.root = useShm ? path.join(shm, 'scryvex-hls') : path.join('/tmp', 'scryvex-hls');
        }

        this.init();
    }

    private init() {
        try {
            if (fs.existsSync(this.root)) {
                // Clean up orphan directories on start
                fs.rmSync(this.root, { recursive: true, force: true });
            }
            fs.mkdirSync(this.root, { recursive: true });
            console.log(`[HlsTempStorage] Initialized at ${this.root}`);
        } catch (err) {
            console.error(`[HlsTempStorage] Failed to initialize root ${this.root}:`, err);
            throw err;
        }
    }

    /**
     * Gets a safe directory path for a specific producer.
     */
    getProducerDir(cameraId: string, producerId: string): string {
        // Prevent path traversal
        if (!/^[a-zA-Z0-9_-]+$/.test(cameraId) || !/^[a-zA-Z0-9_-]+$/.test(producerId)) {
            throw new Error('Invalid cameraId or producerId format for HLS storage');
        }

        const dir = path.join(this.root, cameraId, producerId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    /**
     * Deletes the directory for a specific producer cleanly.
     */
    cleanupProducerDir(cameraId: string, producerId: string) {
        try {
            // Prevent path traversal
            if (!/^[a-zA-Z0-9_-]+$/.test(cameraId) || !/^[a-zA-Z0-9_-]+$/.test(producerId)) {
                return;
            }
            const dir = path.join(this.root, cameraId, producerId);
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`[HlsTempStorage] Failed to cleanup ${cameraId}/${producerId}:`, err);
        }
    }

    /**
     * Validates if a producer has exceeded the max allowed storage limit.
     * Throws an error if exceeded.
     */
    validateProducerSize(cameraId: string, producerId: string) {
        // Prevent path traversal
        if (!/^[a-zA-Z0-9_-]+$/.test(cameraId) || !/^[a-zA-Z0-9_-]+$/.test(producerId)) {
            return;
        }
        const dir = path.join(this.root, cameraId, producerId);
        if (!fs.existsSync(dir)) return;

        let totalBytes = 0;
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const stat = fs.statSync(path.join(dir, file));
                totalBytes += stat.size;
            }
        } catch (err) {
            console.error(`[HlsTempStorage] Error calculating size for ${dir}:`, err);
            return;
        }

        if (totalBytes > this.maxBytesPerProducer) {
            throw new Error(`Producer ${producerId} for camera ${cameraId} exceeded storage limit: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
        }
    }
}
