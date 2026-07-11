import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export class SystemService {
    constructor(private readonly pool: Pool) {}

    async migrate() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS scryvex_core.system_logs (
                id UUID PRIMARY KEY,
                event VARCHAR(160) NOT NULL,
                level VARCHAR(20) NOT NULL DEFAULT 'info',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    }

    /**
     * Sanitiza logs para evitar fuga de credenciales o argumentos demasiado largos
     * Oculta urls con rtsp://user:pass@, recorta strings largos, limpia caracteres de control.
     */
    sanitizeMediaDiagnosticMessage(message: any): any {
        if (typeof message === 'string') {
            // Ocultar rtsp://user:pass@host
            let sanitized = message.replace(/rtsp:\/\/[^:]+:[^@]+@/g, 'rtsp://***:***@');
            // Eliminar caracteres de control menos salto de linea y tab
            sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
            // Limitar longitud
            if (sanitized.length > 2000) {
                sanitized = sanitized.substring(0, 2000) + '...[TRUNCATED]';
            }
            return sanitized;
        } else if (Array.isArray(message)) {
            return message.map(item => this.sanitizeMediaDiagnosticMessage(item));
        } else if (message !== null && typeof message === 'object') {
            const sanitizedObj: any = {};
            for (const [k, v] of Object.entries(message)) {
                // Conservar campos seguros, sanitizar los demás
                if (['host', 'puerto', 'categoría', 'exitCode', 'codec', 'muxer', 'demuxer', 'parser', 'filter', 'duration'].includes(k)) {
                    sanitizedObj[k] = v; // Conservar intacto si es un campo seguro garantizado
                } else {
                    sanitizedObj[k] = this.sanitizeMediaDiagnosticMessage(v);
                }
            }
            return sanitizedObj;
        }
        return message;
    }

    async recordLog(event: string, metadata: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' | 'critical' | 'degraded' = 'info') {
        try {
            const sanitizedMetadata = this.sanitizeMediaDiagnosticMessage(metadata);
            await this.pool.query(
                `INSERT INTO scryvex_core.system_logs (id, event, level, metadata) VALUES ($1, $2, $3, $4)`,
                [randomUUID(), event, level, JSON.stringify(sanitizedMetadata)]
            );
        } catch (e) {
            console.error('[SystemService] Failed to record system log:', e);
        }
    }
}
