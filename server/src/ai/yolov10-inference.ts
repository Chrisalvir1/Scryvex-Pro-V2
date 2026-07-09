import { spawn } from 'child_process';
import * as ort from 'onnxruntime-node';

export class YOLOv10Detector {
    private session!: ort.InferenceSession;

    async init(modelPath: string) {
        this.session = await ort.InferenceSession.create(modelPath);
    }

    startStreamInference(streamUrl: string) {
        const ffmpegArgs = [
            '-i', streamUrl,
            '-f', 'image2pipe',
            '-pix_fmt', 'rgb24',
            '-r', '3', // 3 fps
            '-s', '640x640', // YOLO input size
            '-vcodec', 'rawvideo',
            '-'
        ];

        const ffmpeg = spawn('ffmpeg', ffmpegArgs);
        
        // RGB24 at 640x640 is exactly 640 * 640 * 3 bytes = 1228800 bytes per frame
        const frameSize = 640 * 640 * 3;
        let buffer = Buffer.alloc(0);

        ffmpeg.stdout.on('data', async (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);

            while (buffer.length >= frameSize) {
                const frameBuffer = buffer.subarray(0, frameSize);
                buffer = buffer.subarray(frameSize);

                await this.runInference(frameBuffer);
            }
        });
    }

    private async runInference(frameBuffer: Buffer) {
        const floatData = new Float32Array(640 * 640 * 3);
        for (let i = 0; i < 640 * 640; i++) {
            floatData[i] = frameBuffer[i * 3]! / 255.0; // R
            floatData[640 * 640 + i] = frameBuffer[i * 3 + 1]! / 255.0; // G
            floatData[2 * 640 * 640 + i] = frameBuffer[i * 3 + 2]! / 255.0; // B
        }

        const tensor = new ort.Tensor('float32', floatData, [1, 3, 640, 640]);
        const results = await this.session.run({ images: tensor });
        const outputName = this.session.outputNames[0]!;
        const output = results[outputName]!.data as Float32Array;
        this.processDetections(output);
    }

    private processDetections(output: Float32Array) {
        // Implement logic to parse NMS predictions
        // Trigger Home Assistant WebSocket event upon detection
    }
}
