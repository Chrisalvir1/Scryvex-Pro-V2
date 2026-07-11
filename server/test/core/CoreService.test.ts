import { PluginRepository } from '../../src/core/PluginRepository';
import { DeviceModelFactory } from '../../src/core/DeviceModelFactory';

describe('CoreService Universal Architecture', () => {
    let mockRuntime: any;
    let pluginRepo: PluginRepository;
    let factory: DeviceModelFactory;

    beforeEach(() => {
        mockRuntime = {
            plugins: { 'test-plugin': {} },
            devices: {
                'cam1': {
                    proxy: {
                        id: 'cam1',
                        pluginId: 'test-plugin',
                        name: 'Test Camera',
                        interfaces: ['VideoCamera', 'MotionSensor'],
                        info: { manufacturer: 'TestBrand', model: 'TestModel' },
                        getSettings: jest.fn().mockResolvedValue([
                            { key: 'ip', type: 'string', value: '192.168.1.100' },
                            { key: 'password', type: 'password', value: 'my-super-secret' },
                            { key: 'rtsp_url', type: 'string', value: 'rtsp://admin:secret123@192.168.1.100:554/stream' }
                        ]),
                        getVideoStreamOptions: jest.fn().mockResolvedValue([
                            { id: 'main', name: 'Main Stream', video: { codec: 'h264' } }
                        ])
                    }
                },
                'cam_error': {
                    proxy: {
                        id: 'cam_error',
                        pluginId: 'test-plugin',
                        name: 'Error Camera',
                        interfaces: [],
                        getSettings: jest.fn().mockRejectedValue(new Error('Settings timeout')),
                        getVideoStreamOptions: jest.fn().mockRejectedValue(new Error('Media timeout'))
                    }
                }
            }
        };
        pluginRepo = new PluginRepository(mockRuntime);
        factory = new DeviceModelFactory();
    });

    test('PluginRepository isolates runtime access and returns flat snapshot', async () => {
        const snapshot = await pluginRepo.getRawSnapshot('cam1');
        expect(snapshot).toBeDefined();
        // Check for no proxy methods
        expect((snapshot as any).getSettings).toBeUndefined();
        expect(snapshot?.id).toBe('cam1');
        // Secrets are redacted immediately
        const pwd = snapshot?.settings.find(s => s.key === 'password');
        expect(pwd?.value).toBeNull();
    });

    test('PluginRepository sanitizes URLs with credentials', async () => {
        const snapshot = await pluginRepo.getRawSnapshot('cam1');
        const urlSetting = snapshot?.settings.find(s => s.key === 'rtsp_url');
        expect(urlSetting?.value).toBe('rtsp://***:***@192.168.1.100:554/stream');
    });

    test('PluginRepository preserves errors as readErrors', async () => {
        const snapshot = await pluginRepo.getRawSnapshot('cam_error');
        expect(snapshot?.readErrors).toHaveLength(2);
        expect(snapshot?.readErrors.find(e => e.source === 'settings')?.message).toContain('Settings timeout');
        expect(snapshot?.readErrors.find(e => e.source === 'media')?.message).toContain('Media timeout');
    });

    test('DeviceModelFactory produces stable hash for identical reads', async () => {
        const snapshot1 = await pluginRepo.getRawSnapshot('cam1');
        const model1 = factory.buildFromSnapshot(snapshot1!);
        
        // Let time pass (to ensure observedAt/generatedAt changes don't affect hash)
        await new Promise(r => setTimeout(r, 10));
        
        const snapshot2 = await pluginRepo.getRawSnapshot('cam1');
        const model2 = factory.buildFromSnapshot(snapshot2!);

        expect(model1.revision).toBe(model2.revision);
    });

    test('DeviceModelFactory revision changes when snapshot changes', async () => {
        const snapshot1 = await pluginRepo.getRawSnapshot('cam1');
        const model1 = factory.buildFromSnapshot(snapshot1!);

        // Simulate a setting change in runtime
        mockRuntime.devices['cam1'].proxy.getSettings.mockResolvedValue([
            { key: 'ip', type: 'string', value: '192.168.1.101' }
        ]);

        const snapshot2 = await pluginRepo.getRawSnapshot('cam1');
        const model2 = factory.buildFromSnapshot(snapshot2!);

        expect(model1.revision).not.toBe(model2.revision);
    });

    test('Handles missing proxy gracefully', async () => {
        expect(await pluginRepo.getRawSnapshot('does-not-exist')).toBeUndefined();
    });
});
