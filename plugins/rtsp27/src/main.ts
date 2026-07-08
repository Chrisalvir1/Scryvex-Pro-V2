import "@scryvex/camera-core";
import "@scryvex/compat-engine";
import "@scryvex/runtime";
import "@scryvex/registry";

import { RtspProvider } from "./rtsp";

export default class RTSPCameraProvider extends RtspProvider {
    getScryptedDeviceCreator(): string {
        return 'RTSP Camera';
    }
}
