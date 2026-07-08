export interface CameraStream {
  url: string;
  codec: 'h264' | 'h265' | 'unknown';
  width: number;
  height: number;
  fps: number;
  remuxable: boolean;
}

export interface CameraCapabilities {
  id: string;
  name: string;
  streams: CameraStream[];
  hasPTZ: boolean;
  hasMotion: boolean;
  hasAudio: boolean;
  hasLight: boolean;
  hasSiren: boolean;
}
