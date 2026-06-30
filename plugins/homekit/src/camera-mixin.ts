import { SettingsMixinDeviceOptions } from "@scrypted/common/src/settings-mixin";
import sdk, { MediaObject, ObjectDetector, Readme, RequestMediaStreamOptions, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, VideoCamera } from "@scrypted/sdk";
import { StorageSettings, StorageSettingsDevice } from "@scrypted/sdk/storage-settings";
import { scoreHomeKitStream } from '../../ffmpeg-camera/src/common';
import { HomekitMixin } from "./homekit-mixin";
import { getDebugMode } from "./types/camera/camera-debug-mode-storage";

const { systemManager, deviceManager, log } = sdk;

export const defaultObjectDetectionContactSensorTimeout = 60;

export function canCameraMixin(type: ScryptedDeviceType | string, interfaces: string[]) {
    return (type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell)
        && interfaces.includes(ScryptedInterface.VideoCamera);
}

export function createCameraStorageSettings(device: StorageSettingsDevice) {
    return new StorageSettings(device, {
        hasWarnedBridgedCamera: {
            description: 'Setting to warn user that bridged cameras are bad.',
            type: 'boolean',
            hide: true,
        },
        doorbellAutomationButton: {
            title: 'Doorbell Automation Button',
            type: 'boolean',
            description: 'Add an unconfigured doorbell button to HomeKit that can be used to create automations.',
            hide: true,
        },
    });
}

export class CameraMixin extends HomekitMixin<Readme & VideoCamera> implements Readme, VideoCamera {
    cameraStorageSettings = createCameraStorageSettings(this);

    constructor(options: SettingsMixinDeviceOptions<Readme & VideoCamera>) {
        super(options);

        this.storageSettings.settings.standalone.persistedDefaultValue = true;
        this.cameraStorageSettings.settings.doorbellAutomationButton.hide = this.type !== ScryptedDeviceType.Doorbell;

        if (!this.cameraStorageSettings.values.hasWarnedBridgedCamera && !this.storageSettings.values.standalone) {
            this.cameraStorageSettings.values.hasWarnedBridgedCamera = true;
            log.a(`${this.name} is paired in Bridge Mode. Using Accessory Mode is recommended for cameras for optimal performance.`)
        }
    }

    async getReadmeMarkdown(): Promise<string> {
        let readme = this.mixinDeviceInterfaces.includes(ScryptedInterface.Readme) ? await this.mixinDevice.getReadmeMarkdown() + '\n\n' : '';

        if (!this.storageSettings.values.standalone) {
            readme += `
## <span style="color:red">HomeKit Performance Warning</span>

HomeKit Cameras should be paired to HomeKit in Accessory Mode for optimal performance. iOS 15.5+ will always route bridged camera video through the active HomeHub, which may result in severe performance degradation.

Enable Standalone Accessory Mode in the HomeKit settings for this camera and reload the HomeKit plugin. This camera can then be individually paired with the Home app. The pairing QR code can be seen in this camera\'s console.

More details can be found [here](https://github.com/koush/scrypted/blob/main/plugins/homekit/notes/iOS-15.5.md).
`;
        }

        const id = deviceManager.getDeviceState(this.mixinProviderNativeId).id;
        readme += `
## HomeKit Codec Settings

The recommended codec settings for cameras in HomeKit can be viewed in the [HomeKit plugin](#/device/${id}).

## HomeKit Troubleshooting

The latest troubleshooting guide for all known streaming or recording issues can be viewed in the [HomeKit plugin](#/device/${id}).`;

        if (this.storageSettings.values.standalone) {
            readme += `

## HomeKit Pairing

${this.storageSettings.values.pincode}
${this.storageSettings.values.qrCode}
            `
        }

        return readme;
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings: Setting[] = [];

        // settings.push({
        //     title: 'H265 Streams',
        //     key: 'h265Support',
        //     description: 'Camera outputs h265 codec streams.',
        //     value: (this.storage.getItem('h265Support') === 'true').toString(),
        //     type: 'boolean',
        // });

        settings.push({
            title: 'RTP Sender',
            subgroup: 'Debug',
            key: 'rtpSender',
            description: 'The RTP Sender used by Scrypted. FFMpeg is stable. Scrypted is experimental and much faster.',
            choices: [
                'Default',
                'Scrypted',
                'FFmpeg',
            ],
            value: this.storage.getItem('rtpSender') || 'Default',
        });

        let debugMode = getDebugMode(this.storage);

        settings.push({
            title: 'Debug Mode',
            subgroup: 'Debug',
            key: 'debugMode',
            description: 'Force transcoding on this camera for streaming and recording. This setting can be used to diagnose errors with HomeKit functionality. Enable the Rebroadcast plugin for more robust transcoding options.',
            choices: [
                'Transcode Video',
                'Transcode Audio',
                'Save Recordings',
            ],
            multiple: true,
            value: debugMode.value,
        });

        if (this.interfaces.includes(ScryptedInterface.OnOff)) {
            settings.push({
                title: 'Camera Status Indicator',
                description: 'Allow HomeKit to control the camera status indicator light.',
                key: 'statusIndicator',
                value: this.storage.getItem('statusIndicator') === 'true',
                type: 'boolean',
            });
        }

        return [...await super.getMixinSettings(), ...settings, ...await this.cameraStorageSettings.getSettings()];
    }

    async putMixinSetting(key: string, value: SettingValue) {
        if (this.storageSettings.settings[key]) {
            return super.putMixinSetting(key, value);
        }

        if (key === 'debugMode') {
            this.storage.setItem(key, JSON.stringify(value));
        }
        else {
            this.storage.setItem(key, value?.toString() || '');
        }

        deviceManager.onMixinEvent(this.id, this, ScryptedInterface.Settings, undefined);
    }

    /**
     * Intercept getVideoStream so HomeKit always routes requests through the
     * best-available stream, using the shared HomeKit-compatibility score.
     *
     * Selection rules (in order of priority):
     *  1. Caller already specifies a stream id  → honour it directly.
     *  2. homekitPreferred flag on a stream      → prefer that stream.
     *  3. directRemux + H.264                   → strong preference.
     *  4. Highest score overall (codec + res)    → smart fallback.
     *  5. First stream                           → safe last resort.
     *
     * Single-stream cameras are completely unaffected because all paths
     * collapse to vsos[0] when only one stream is available.
     */
    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        // If the caller requested a specific stream id (e.g. intercom, snapshot
        // or user-selected stream), pass through without overriding.
        if (options?.id)
            return this.mixinDevice.getVideoStream(options);

        let vsos: any[];
        try {
            vsos = await this.mixinDevice.getVideoStreamOptions();
        }
        catch (e) {
            // getVideoStreamOptions failed (e.g. camera offline) — fall back
            // to the unmodified call so existing error handling is preserved.
            return this.mixinDevice.getVideoStream(options);
        }

        if (!vsos?.length)
            return this.mixinDevice.getVideoStream(options);

        // Single-stream camera: no selection needed.
        if (vsos.length === 1)
            return this.mixinDevice.getVideoStream(options);

        // Score all streams. scoreHomeKitStream is safe for objects without
        // the new metadata fields (returns 0 → falls through to first stream).
        const scored = vsos
            .map(s => ({ s, score: scoreHomeKitStream(s) }))
            .sort((a, b) => b.score - a.score);

        const best = scored[0];
        const chosen = best.score > 0 ? best.s : vsos[0];

        this.console.log(
            `[homekit] stream selection: id=${chosen.id} name=${chosen.name}` +
            ` codec=${chosen.video?.codec || chosen.sourceCodec || 'unknown'}` +
            ` ${chosen.video?.width || '?'}x${chosen.video?.height || '?'}` +
            ` score=${best.score}` +
            (chosen.homekitPreferred ? ' [homekitPreferred]' : '') +
            (chosen.directRemux ? ' [directRemux]' : '')
        );

        return this.mixinDevice.getVideoStream({
            ...options,
            id: chosen.id,
        });
    }
}

