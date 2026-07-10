import { spawn } from 'child_process';
import * as ort from 'onnxruntime-node';

export class YOLOv10Detector {
    private session!: ort.InferenceSession;

    async init(modelPath: string) {
        this.session = await ort.InferenceSession.create(modelPath);
    }

    startStreamInference(cameraId: string, streamUrl: string, onDetection: (event: any) => void) {
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

                await this.runInference(cameraId, frameBuffer, onDetection);
            }
        });
    }

    private async runInference(cameraId: string, frameBuffer: Buffer, onDetection: (event: any) => void) {
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
        this.processDetections(cameraId, output, onDetection);
    }

    private processDetections(cameraId: string, output: Float32Array, onDetection: (event: any) => void) {
        const numDetections = output.length / 6;
        for (let i = 0; i < numDetections; i++) {
            const offset = i * 6;
            const confidence = output[offset + 4]!;
            if (confidence > 0.5) {
                const classId = Math.round(output[offset + 5]!);
                // COCO classes: 0 = person, 2 = car, 16 = dog, 17 = horse
                let label = 'unknown';
                if (classId === 0) label = 'person';
                else if (classId === 2) label = 'vehicle';
                else if (classId === 16 || classId === 17) label = 'pet';

                if (label !== 'unknown') {
                    onDetection({
                        cameraId,
                        label,
                        confidence: Math.round(confidence * 100),
                        box: [output[offset], output[offset + 1], output[offset + 2], output[offset + 3]]
                    });
                }
            }
        }
    }
}
