import { useState } from 'react';
import { useScrypted } from './useScrypted';
import { CameraDashboard } from './CameraDashboard';
import { NativeDeviceSettings } from './NativeDeviceSettings';
import './index.css';

function hasInterface(device: any, ...interfaces: string[]) {
  return interfaces.some(i => device.interfaces?.includes(i));
}

function isCamera(device: any) {
  return hasInterface(device, 'VideoCamera', 'Camera', 'RTCSignalingChannel')
    || ['Camera', 'Doorbell'].includes(device.type)
    || ['Camera', 'Doorbell'].includes(device.providedType);
}

function isPlugin(device: any) {
  return device.id === device.pluginId
    || hasInterface(device, 'DeviceProvider', 'MixinProvider', 'MediaConverter', 'HttpRequestHandler')
    || ['API', 'Internal', 'Builtin'].includes(device.type);
}

function App() {
  const { client, error, devices } = useScrypted();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'cameras' | 'plugins'>('dashboard');
  const [selectedDevice, setSelectedDevice] = useState<{ id: string, mode: 'preview' | 'settings' } | null>(null);
  const [selectedIframe, setSelectedIframe] = useState<string | null>(null);

  if (error) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <h2 style={{ color: '#ff4444' }}>Connection Error</h2>
          <p>{error}</p>
          <button className="glass-button" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
          <h2 className="text-gradient">Scrypted Pro G&C</h2>
          <p>Connecting to server...</p>
        </div>
      </div>
    );
  }

  const cameras = devices.filter(isCamera);
  const plugins = devices.filter(isPlugin);

  return (
    <div className="layout">
      <div className="sidebar">
        <h2 style={{ color: 'var(--accent-cyan)', marginBottom: '32px' }}>Scrypted Pro G&C</h2>
        
        <div 
          className={`glass-card ${activeTab === 'dashboard' ? 'active' : ''}`}
          style={{ padding: '12px 16px', marginBottom: '16px', cursor: 'pointer', borderLeft: activeTab === 'dashboard' ? '4px solid var(--accent-cyan)' : '' }}
          onClick={() => setActiveTab('dashboard')}
        >
          Dashboard
        </div>
        <div 
          className={`glass-card ${activeTab === 'cameras' ? 'active' : ''}`}
          style={{ padding: '12px 16px', marginBottom: '16px', cursor: 'pointer', borderLeft: activeTab === 'cameras' ? '4px solid var(--accent-cyan)' : '' }}
          onClick={() => setActiveTab('cameras')}
        >
          Cameras
        </div>
        <div 
          className={`glass-card ${activeTab === 'plugins' ? 'active' : ''}`}
          style={{ padding: '12px 16px', marginBottom: '16px', cursor: 'pointer', borderLeft: activeTab === 'plugins' ? '4px solid var(--accent-cyan)' : '' }}
          onClick={() => setActiveTab('plugins')}
        >
          Plugins
        </div>
      </div>

      <div className="main-content">
        {selectedDevice && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-primary)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--glass-border)' }}>
              <h2 style={{ margin: 0 }}>
                {devices.find(d => d.id === selectedDevice.id)?.name || 'Device'} - {selectedDevice.mode === 'preview' ? 'Live Preview' : 'Settings'}
              </h2>
              <button className="glass-button" onClick={() => setSelectedDevice(null)}>Close</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {selectedDevice.mode === 'preview' ? (
                <CameraDashboard device={devices.find(d => d.id === selectedDevice.id)!} />
              ) : (
                <NativeDeviceSettings device={devices.find(d => d.id === selectedDevice.id)!} />
              )}
            </div>
          </div>
        )}

        {selectedIframe && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-primary)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--glass-border)' }}>
              <h2 style={{ margin: 0 }}>Install Plugin (Legacy)</h2>
              <button className="glass-button" onClick={() => setSelectedIframe(null)}>Close</button>
            </div>
            <iframe src={selectedIframe} style={{ flex: 1, width: '100%', border: 'none' }} />
          </div>
        )}
        
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="glass-card" style={{ padding: '8px 16px', color: 'var(--accent-cyan)', fontSize: '14px' }}>
              Connected
            </div>
          </div>
        </div>

        <div style={{ marginTop: '24px' }}>
        {activeTab === 'dashboard' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h4 style={{ color: 'var(--text-secondary)' }}>Total Devices</h4>
              <h1 style={{ fontSize: '48px', margin: '16px 0' }}>{devices.length}</h1>
            </div>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h4 style={{ color: 'var(--text-secondary)' }}>Cameras Active</h4>
              <h1 style={{ fontSize: '48px', margin: '16px 0', color: 'var(--accent-cyan)' }}>{cameras.length}</h1>
            </div>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h4 style={{ color: 'var(--text-secondary)' }}>Plugins Loaded</h4>
              <h1 style={{ fontSize: '48px', margin: '16px 0', color: 'var(--accent-cyan)' }}>{plugins.length}</h1>
            </div>
          </div>
        )}

        {activeTab === 'cameras' && (
          <div>
            <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="glass-button" style={{ background: 'var(--accent-cyan)', color: '#000', fontWeight: 'bold' }} onClick={() => setSelectedIframe(`legacy/#/device?embedded=true`)}>+ Add Device</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
            {cameras.map(cam => (
              <div key={cam.id} className="glass-card" style={{ overflow: 'hidden' }}>
                <div style={{ height: '180px', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.7)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', color: '#fff' }}>
                    {cam.online === false ? 'Offline' : 'Online'}
                  </div>
                  <button className="glass-button" onClick={() => setSelectedDevice({ id: cam.id, mode: 'preview' })}>Preview Live</button>
                </div>
                <div style={{ padding: '16px' }}>
                  <h3 style={{ margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cam.name}</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Type: {cam.type || cam.providedType || 'Camera'}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Plugin: {cam.pluginId || cam.providerId || 'unknown'}
                  </p>
                  <button className="glass-button" style={{ marginTop: '16px', width: '100%' }} onClick={() => setSelectedDevice({ id: cam.id, mode: 'settings' })}>Settings</button>
                </div>
              </div>
            ))}
            {cameras.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No cameras found.</p>}
          </div>
          </div>
        )}

        {activeTab === 'plugins' && (
          <div>
            <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="glass-button" style={{ background: 'var(--accent-cyan)', color: '#000', fontWeight: 'bold' }} onClick={() => setSelectedIframe(`legacy/#/component/plugin/install?embedded=true`)}>+ Install NPM Plugin</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
              {plugins.map(plugin => (
                <div key={plugin.id} className="glass-card" style={{ padding: '24px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>{plugin.name}</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    {plugin.pluginId}
                  </p>
                  <button className="glass-button" style={{ marginTop: '16px' }} onClick={() => setSelectedDevice({ id: plugin.id, mode: 'settings' })}>Settings</button>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

export default App;
