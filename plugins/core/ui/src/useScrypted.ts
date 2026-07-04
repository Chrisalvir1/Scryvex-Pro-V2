import { useState, useEffect } from 'react';
import { connectScryptedClient } from '@scrypted/client';
import type { ScryptedClientStatic } from '@scrypted/client';
import type { ScryptedDevice } from '@scrypted/types';

export type ScryptedUiDevice = ScryptedDevice & {
  id: string;
  interfaces?: string[];
  pluginId?: string;
  providerId?: string;
  type?: string;
  online?: boolean;
};

export function useScrypted() {
  const [client, setClient] = useState<ScryptedClientStatic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<ScryptedUiDevice[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const match = window.location.href.match(/^(.*)\/endpoint\/@scrypted\/core\/public/);
        let baseUrl = match ? match[1] : (window.location.origin + window.location.pathname);
        if (!baseUrl.endsWith('/')) {
          baseUrl += '/';
        }

        const scrypted = await connectScryptedClient({
          pluginId: '@scrypted/core',
          clientName: 'Scrypted Pro G&C',
          baseUrl
        });
        
        setClient(scrypted);
        
        const loadDevices = () => {
          const state = scrypted.systemManager.getSystemState();
          const devList = Object.entries(state).map(([id, deviceState]: [string, any]) => {
            const device = scrypted.systemManager.getDeviceById(id) as any;
            return {
              ...(device || {}),
              ...deviceState,
              id,
              interfaces: deviceState.interfaces?.value || device?.interfaces || [],
              name: deviceState.name?.value || device?.name || id,
              type: deviceState.type?.value || device?.type,
              pluginId: deviceState.pluginId?.value || device?.pluginId,
              providerId: deviceState.providerId?.value || device?.providerId,
              online: deviceState.online?.value ?? device?.online,
            } as ScryptedUiDevice;
          });
          if (!cancelled)
            setDevices(devList);
        };

        loadDevices();

        const listener = scrypted.systemManager.listen?.(() => loadDevices());
        const interval = setInterval(loadDevices, 5000);
        return () => {
          clearInterval(interval);
          listener?.removeListener?.();
        };
        
      } catch (err: any) {
        console.error('Failed to connect to Scrypted:', err);
        // Fallback for development without a real server
        if (import.meta.env.DEV) {
          console.warn('Using mock data for development mode');
          setDevices([
            { name: 'Mock Camera 1', id: 'mock-1', interfaces: ['Camera', 'VideoCamera'] } as any,
            { name: 'Mock Camera 2', id: 'mock-2', interfaces: ['Camera', 'VideoCamera'] } as any,
            { name: 'HomeKit', id: 'mock-3', interfaces: ['MixinProvider'], pluginId: '@scrypted/homekit' } as any
          ]);
          setClient({} as any);
        } else {
          setError(err.message || 'Connection failed');
        }
      }
    }
    let cleanup: any;
    init().then(ret => cleanup = ret);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return { client, error, devices };
}
