import { spawn, ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';

const REDACT_CREDENTIAL_RE = /([a-zA-Z][a-zA-Z\d+\-.]*:\/\/)[^:@/\s]+:[^@\s]+@/g;

function redactStderr(raw: string): string {
    return raw.replace(REDACT_CREDENTIAL_RE, '$1***:***@');
}

export interface MediaProcessOptions {
    command: string;
    args: string[];
    timeoutMs?: number;
    /** Default 8 MiB. If stdout exceeds this the process is killed. */
    maxStdoutBytes?: number;
    /** Default 64 KiB. stderr is silently truncated beyond this. */
    maxStderrBytes?: number;
    signal?: AbortSignal;
    inputStream?: Readable;
    inputBuffer?: Buffer;
    /** If provided, stdout is piped here and maxStdoutBytes is ignored. Backpressure is handled automatically. */
    outputStream?: NodeJS.WritableStream;
    /** Raw callback, ignores maxStdoutBytes if provided. If it returns false, you must handle resume() manually or provide outputStream instead. */
    onStdout?: (chunk: Buffer) => boolean | void;
    onStderr?: (chunk: Buffer) => void;
}


export interface MediaProcessResult {
    exitCode: number | null;
    stdout: Buffer;
    /** Redacted stderr — no credentials. */
    stderr: string;
    durationMs: number;
    timedOut: boolean;
    killedForSize: boolean;
}

export interface IMediaProcessRunner {
    run(options: MediaProcessOptions): Promise<MediaProcessResult>;
    spawnStreaming(options: MediaProcessOptions): {
        process: ChildProcess;
        promise: Promise<MediaProcessResult>;
    };
}

const DEFAULT_MAX_STDOUT = 8 * 1024 * 1024;  // 8 MiB
const DEFAULT_MAX_STDERR = 64 * 1024;         // 64 KiB
const SIGKILL_GRACE_MS   = 3_000;

function killGracefully(child: ChildProcess): void {
    if (child.exitCode !== null) return; // Process already exited
    child.kill('SIGTERM');
    const t = setTimeout(() => {
        // child.killed only means a signal was sent, not that it died.
        // We must check exitCode to know if it's still running.
        if (child.exitCode === null) child.kill('SIGKILL');
    }, SIGKILL_GRACE_MS);
    if (t.unref) t.unref();
}

export class DefaultMediaProcessRunner implements IMediaProcessRunner {
    run(options: MediaProcessOptions): Promise<MediaProcessResult> {
        return this.spawnStreaming(options).promise;
    }

    spawnStreaming(options: MediaProcessOptions): { process: ChildProcess; promise: Promise<MediaProcessResult> } {
        const start = Date.now();
        const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT;
        const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR;

        const hasStdin = !!(options.inputStream || options.inputBuffer);
        const child = spawn(options.command, options.args, {
            stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        });

        // ── stdin ─────────────────────────────────────────────────────────────
        if (child.stdin) {
            if (options.inputBuffer) {
                child.stdin.write(options.inputBuffer);
                child.stdin.end();
            } else if (options.inputStream) {
                options.inputStream.pipe(child.stdin);
                options.inputStream.on('error', () => killGracefully(child));
            }
        }

        // ── stdout ────────────────────────────────────────────────────────────
        let stdoutBytes = 0;
        let killedForSize = false;
        const stdoutChunks: Buffer[] = [];

        if (options.outputStream) {
            // Native pipe handles backpressure automatically
            child.stdout?.pipe(options.outputStream, { end: false });
        } else if (child.stdout) {
            child.stdout.on('data', (chunk: Buffer) => {
                if (options.onStdout) {
                    const canContinue = options.onStdout(chunk);
                    // Si onStdout devuelve false explícitamente y tenemos acceso al stream subyacente (asumiendo EventEmitter), pausamos
                    // Lo ideal es que el usuario pase outputStream en su lugar para delegar esto a Node.
                    if (canContinue === false) {
                        child.stdout?.pause();
                    }
                } else {
                    stdoutBytes += chunk.length;
                    if (stdoutBytes > maxStdout) {
                        if (!killedForSize) {
                            killedForSize = true;
                            killGracefully(child);
                        }
                        return;
                    }
                    stdoutChunks.push(chunk);
                }
            });
        }

        // ── stderr ────────────────────────────────────────────────────────────
        let stderrRaw = '';
        let stderrBytes = 0;
        child.stderr?.on('data', (chunk: Buffer) => {
            if (options.onStderr) {
                options.onStderr(chunk);
            } else if (stderrBytes < maxStderr) {
                const text = chunk.toString('utf8');
                const remaining = maxStderr - stderrBytes;
                stderrRaw += text.length > remaining ? text.slice(0, remaining) : text;
                stderrBytes += text.length;
            }
        });

        // ── timeout ───────────────────────────────────────────────────────────
        let timedOut = false;
        let timer: NodeJS.Timeout | undefined;
        if (options.timeoutMs) {
            timer = setTimeout(() => {
                timedOut = true;
                killGracefully(child);
            }, options.timeoutMs);
            if (timer.unref) timer.unref();
        }

        // ── abort signal ──────────────────────────────────────────────────────
        const abortHandler = () => {
            if (timer) clearTimeout(timer);
            killGracefully(child);
        };
        options.signal?.addEventListener('abort', abortHandler, { once: true });

        // ── promise ───────────────────────────────────────────────────────────
        const promise = new Promise<MediaProcessResult>((resolve) => {
            let settled = false;
            const finish = (code: number | null) => {
                if (settled) return;
                settled = true;

                if (timer) clearTimeout(timer);
                options.signal?.removeEventListener('abort', abortHandler);

                // Close any piped inputStream to prevent resource leaks
                if (options.inputStream && !options.inputStream.destroyed) {
                    try { options.inputStream.destroy(); } catch { /* ignore */ }
                }

                resolve({
                    exitCode: (timedOut || options.signal?.aborted) ? null : code,
                    stdout: Buffer.concat(stdoutChunks),
                    stderr: redactStderr(stderrRaw),
                    durationMs: Date.now() - start,
                    timedOut,
                    killedForSize,
                });
            };

            child.on('close', finish);
            child.on('error', (err) => {
                stderrRaw += `\nSpawn error: ${err.message}`;
                finish(null);
            });
        });

        return { process: child, promise };
    }
}



