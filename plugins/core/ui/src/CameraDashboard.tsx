import { useEffect, useState } from 'react';
import type { ResponseMediaStreamOptions, ScryptedDevice } from '@scrypted/types';
import { useScrypted } from './useScrypted';
import { NativeDeviceSettings } from './NativeDeviceSettings';

export function CameraDashboard({ device }: { device: ScryptedDevice }) {
    const { client } = useScrypted();
    const [logs, setLogs] = useState<string[]>([]);
    const [streamOptions, setStreamOptions] = useState<ResponseMediaStreamOptions[]>([]);
    const [streamError, setStreamError] = useState<string | null>(null);
    const [testStatus, setTestStatus] = useState<string>('Not tested yet.');

    useEffect(() => {
        let cancelled = false;
        async function loadStreams() {
            try {
                if (!(device as any).getVideoStreamOptions)
                    return;
                const options = await (device as any).getVideoStreamOptions();
                if (!cancelled) {
                    setStreamOptions(options || []);
                    setStreamError(null);
                }
            }
            catch (e: any) {
                if (!cancelled)
                    setStreamError(e?.message || String(e));
            }
        }
        loadStreams();
        const interval = setInterval(loadStreams, 10000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [device.id]);
    
    // Subscribe to logs
    useEffect(() => {
        if (!client) return;
        let listener: any;
        try {
            listener = (device as any).listen?.({ event: 'Logger' }, (_event: any, _details: any, data: any) => {
                const message = typeof data === 'string' ? data : JSON.stringify(data);
                setLogs(prev => [...prev, message].slice(-100));
            });
        }
        catch (e: any) {
            setLogs(prev => [...prev, `Logger subscription failed: ${e?.message || e}`].slice(-100));
        }
        
        return () => {
            listener?.removeListener?.();
        };
    }, [client, device.id]);

    const testStream = async (stream?: ResponseMediaStreamOptions) => {
        try {
            setTestStatus(`Testing ${stream?.name || stream?.id || 'default stream'}...`);
            setLogs(prev => [...prev, `[ui] testing stream ${stream?.name || stream?.id || 'default'}`].slice(-100));
            if (!(device as any).getVideoStream)
                throw new Error('Device does not implement getVideoStream.');
            const mediaObject = await (device as any).getVideoStream(stream);
            setTestStatus(`Stream opened: ${mediaObject?.mimeType || 'media object returned'}`);
            setLogs(prev => [...prev, `[ui] stream opened successfully: ${mediaObject?.mimeType || 'media object returned'}`].slice(-100));
        }
        catch (e: any) {
            const message = e?.message || String(e);
            setTestStatus(`Stream failed: ${message}`);
            setLogs(prev => [...prev, `[ui] stream failed: ${message}`].slice(-100));
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: '300px' }}>
                <div style={{ flex: 2, background: '#05070d', borderRadius: '8px', overflow: 'auto', position: 'relative', padding: '18px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ margin: '0 0 12px 0', color: 'var(--accent-cyan)' }}>Stream Check</h3>
                    <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
                        {testStatus}
                    </p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                        <button className="glass-button" onClick={() => testStream()}>Test Default Stream</button>
                        {streamOptions.map((stream, index) => (
                            <button
                                key={stream.id || index}
                                className="glass-button"
                                onClick={() => testStream(stream)}
                            >
                                Test {stream.name || stream.id || `Stream ${index + 1}`}
                            </button>
                        ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                        {streamOptions.map((stream, index) => (
                            <div key={stream.id || index} className="glass-card" style={{ padding: '12px' }}>
                                <strong>{stream.name || stream.id || `Stream ${index + 1}`}</strong>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                                    Video: {stream.video?.codec || (stream as any).sourceCodec || 'unknown'}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Audio: {stream.audio === null ? 'none' : stream.audio?.codec || 'unknown'}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Container: {stream.container || 'unknown'}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Remux: {(stream as any).directRemux ? 'direct' : 'auto/transcode if needed'}
                                </div>
                            </div>
                        ))}
                        {!streamOptions.length && (
                            <div style={{ color: 'var(--text-secondary)' }}>
                                {streamError ? `Stream options failed: ${streamError}` : 'No stream options reported yet.'}
                            </div>
                        )}
                    </div>
                </div>
                
                <div style={{ flex: 1, background: '#1e1e1e', color: '#00ff00', fontFamily: 'monospace', padding: '8px', borderRadius: '8px', overflowY: 'auto', fontSize: '12px' }}>
                    <h4 style={{ color: '#fff', margin: '0 0 8px 0', borderBottom: '1px solid #444', paddingBottom: '4px' }}>Live Logs / Stream Test</h4>
                    {logs.length === 0 ? (
                        <span style={{ color: '#888' }}>Waiting for logs... (Check if camera is online)</span>
                    ) : (
                        logs.map((log, i) => <div key={i}>{log}</div>)
                    )}
                </div>
            </div>
            
            <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px' }}>
                <h3 style={{ margin: '0 0 16px 0', color: 'var(--accent-cyan)' }}>Codec & Settings (H.264/HEVC Remux)</h3>
                <NativeDeviceSettings device={device} />
            </div>
        </div>
    );
}
