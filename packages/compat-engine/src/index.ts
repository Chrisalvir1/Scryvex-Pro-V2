import { CameraCapabilities, CameraStream } from '@scryvex/camera-core';

export interface CompatResult {
  canRemux: boolean;
  requiresTranscode: boolean;
  reason: string;
  recommendedStream: CameraStream | null;
}

export function evaluateCompat(camera: CameraCapabilities): CompatResult {
  const h264 = camera.streams.find(s => s.codec === 'h264' && s.remuxable);
  if (h264) return { canRemux: true, requiresTranscode: false, reason: 'H.264 directo disponible', recommendedStream: h264 };
  const h265 = camera.streams.find(s => s.codec === 'h265');
  if (h265) return { canRemux: false, requiresTranscode: true, reason: 'Solo H.265, requiere hardware transcode', recommendedStream: h265 };
  return { canRemux: false, requiresTranscode: false, reason: 'Sin stream compatible detectado', recommendedStream: null };
}
