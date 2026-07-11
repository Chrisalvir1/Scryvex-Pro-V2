import { useState, useEffect, useCallback } from 'react';
import type { DeviceModelView } from '@scryvex/contracts';
import { apiUrl } from '../lib/ingress-url';

export function useUniversalDevices() {
    const [devices, setDevices] = useState<DeviceModelView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchDevices = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch(apiUrl('/api/scrypted/devices'));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setDevices(data.devices || []);
            setError(null);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch devices');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDevices();
    }, [fetchDevices]);

    return {
        devices,
        loading,
        error,
        refetch: fetchDevices
    };
}
