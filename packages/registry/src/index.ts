import { CameraCapabilities } from '@scryvex/camera-core';

const registry = new Map<string, CameraCapabilities>();

export function registerCamera(c: CameraCapabilities): void {
  registry.set(c.id, c);
  console.log(`[registry] registered: ${c.name} (${c.id})`);
}

export function getCamera(id: string): CameraCapabilities | undefined {
  return registry.get(id);
}

export function getAllCameras(): CameraCapabilities[] {
  return Array.from(registry.values());
}

export function unregisterCamera(id: string): void {
  registry.delete(id);
}
