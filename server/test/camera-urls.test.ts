import test from 'node:test';
import assert from 'node:assert';
import { cameraStreamUrl, redactCameraSecrets, classifyRtspError, normalizeCodec } from '../src/cameras/camera-adapter.js';

test('1. Normalización de URL y credenciales / 17. Contraseñas con caracteres especiales', async (t) => {
    await t.test('Contraseña con @', () => {
        const input = { ip: '1.2.3.4', port: 554, username: 'admin', password: 'p@ssword' };
        const url = cameraStreamUrl(input, 'rtsp://1.2.3.4/live');
        assert.strictEqual(url, 'rtsp://admin:p%40ssword@1.2.3.4/live');
    });

    await t.test('Contraseña con :', () => {
        const input = { ip: '1.2.3.4', port: 554, username: 'admin', password: 'p:ssword' };
        const url = cameraStreamUrl(input, 'rtsp://1.2.3.4/live');
        assert.strictEqual(url, 'rtsp://admin:p%3Assword@1.2.3.4/live');
    });

    await t.test('Contraseña con %', () => {
        const input = { ip: '1.2.3.4', port: 554, username: 'admin', password: 'p%ssword' };
        const url = cameraStreamUrl(input, 'rtsp://1.2.3.4/live');
        assert.strictEqual(url, 'rtsp://admin:p%25ssword@1.2.3.4/live');
    });

    await t.test('Usuario con espacios', () => {
        const input = { ip: '1.2.3.4', port: 554, username: 'my user', password: '123' };
        const url = cameraStreamUrl(input, 'rtsp://1.2.3.4/live');
        assert.strictEqual(url, 'rtsp://my%20user:123@1.2.3.4/live');
    });

    await t.test('URL con credenciales existentes', () => {
        const input = { ip: '1.2.3.4', port: 554, username: 'newuser', password: 'newpassword' };
        const url = cameraStreamUrl(input, 'rtsp://olduser:oldpass@1.2.3.4/live');
        assert.strictEqual(url, 'rtsp://olduser:oldpass@1.2.3.4/live');
    });

    await t.test('URL con query / token aleatorio', () => {
        const input = { ip: '1.2.3.4', port: 554 };
        const url = cameraStreamUrl(input, 'rtsp://1.2.3.4/live?token=secret123');
        assert.strictEqual(url, 'rtsp://1.2.3.4/live?token=secret123');
    });

    await t.test('URL ONVIF que reporta localhost', () => {
        const input = { ip: '192.168.1.100', port: 554, username: 'admin', password: '123' };
        const url = cameraStreamUrl(input, 'rtsp://localhost/stream');
        assert.strictEqual(url, 'rtsp://admin:123@192.168.1.100/stream');
    });
});

test('2. Redacción de secretos', () => {
    assert.strictEqual(
        redactCameraSecrets('rtsp://admin:p@ssword@1.2.3.4/live?token=secret'),
        'rtsp://***@1.2.3.4/live?token=***'
    );
    assert.strictEqual(
        redactCameraSecrets('http://usr:pass@host/api?auth=123'),
        'http://***@host/api?auth=***'
    );
});

test('Clasificación de Errores RTSP (ffprobe/ffmpeg)', () => {
    assert.strictEqual(classifyRtspError('No route to host', 1), 'dns_error');
    assert.strictEqual(classifyRtspError('Connection refused', 1), 'connection_refused');
    assert.strictEqual(classifyRtspError('401 Unauthorized', 1), 'authentication_failed');
    assert.strictEqual(classifyRtspError('404 Not Found', 1), 'rtsp_404');
    assert.strictEqual(classifyRtspError('Invalid data found', 1), 'invalid_media');
    assert.strictEqual(classifyRtspError('No streams found', 1), 'no_video_stream');
    assert.strictEqual(classifyRtspError('Option rw_timeout not found.', 1), 'invalid_arguments');
    assert.strictEqual(classifyRtspError('Unrecognized option', 1), 'invalid_arguments');
});

test('Normalización de Codecs (Fase 2 de Requisitos)', () => {
    assert.strictEqual(normalizeCodec('avc1').normalizedCodec, 'H264');
    assert.strictEqual(normalizeCodec('h265').normalizedCodec, 'H265');
    assert.strictEqual(normalizeCodec('hevc').normalizedCodec, 'H265');
    assert.strictEqual(normalizeCodec('opus').displayCodec, 'Opus');
});
