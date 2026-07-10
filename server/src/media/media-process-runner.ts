import { spawn, ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';

export interface MediaProcessOptions {
    command: string;
    args: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
    inputStream?: Readable;
    inputBuffer?: Buffer;
    onStdout?: (chunk: Buffer) => void;
    onStderr?: (chunk: Buffer) => void;
}

export interface MediaProcessResult {
    exitCode: number | null;
    stdout: Buffer;
    stderr: string;
    durationMs: number;
}

export interface IMediaProcessRunner {
    run(options: MediaProcessOptions): Promise<MediaProcessResult>;
    spawnStreaming(options: MediaProcessOptions): {
        process: ChildProcess;
        promise: Promise<MediaProcessResult>;
    };
}

export class DefaultMediaProcessRunner implements IMediaProcessRunner {
    run(options: MediaProcessOptions): Promise<MediaProcessResult> {
        const { promise } = this.spawnStreaming(options);
        return promise;
    }

    spawnStreaming(options: MediaProcessOptions): { process: ChildProcess, promise: Promise<MediaProcessResult> } {
        const start = Date.now();
        const child = spawn(options.command, options.args, {
            stdio: [options.inputStream || options.inputBuffer ? 'pipe' : 'ignore', 'pipe', 'pipe']
        });

        if (child.stdin) {
            if (options.inputBuffer) {
                child.stdin.write(options.inputBuffer);
                child.stdin.end();
            } else if (options.inputStream) {
                options.inputStream.pipe(child.stdin);
                options.inputStream.on('error', () => {
                    if (!child.killed) child.kill('SIGKILL');
                });
            }
        }

        const stdoutChunks: Buffer[] = [];
        let stderr = '';

        child.stdout?.on('data', chunk => {
            if (options.onStdout) options.onStdout(chunk);
            else stdoutChunks.push(chunk);
        });
        
        child.stderr?.on('data', chunk => {
            if (options.onStderr) options.onStderr(chunk);
            stderr += chunk.toString();
        });

        let timer: NodeJS.Timeout | undefined;
        if (options.timeoutMs) {
            timer = setTimeout(() => {
                if (!child.killed) child.kill('SIGKILL');
            }, options.timeoutMs);
        }

        if (options.signal) {
            options.signal.addEventListener('abort', () => {
                if (timer) clearTimeout(timer);
                if (!child.killed) child.kill('SIGKILL');
            });
        }

        const promise = new Promise<MediaProcessResult>((resolve) => {
            child.on('close', code => {
                if (timer) clearTimeout(timer);
                resolve({
                    exitCode: (options.signal?.aborted || (options.timeoutMs && Date.now() - start > options.timeoutMs)) ? null : code,
                    stdout: Buffer.concat(stdoutChunks),
                    stderr,
                    durationMs: Date.now() - start
                });
            });
            child.on('error', err => {
                if (timer) clearTimeout(timer);
                resolve({
                    exitCode: null,
                    stdout: Buffer.alloc(0),
                    stderr: `Spawn error: ${err.message}`,
                    durationMs: Date.now() - start
                });
            });
        });

        return { process: child, promise };
    }
}
