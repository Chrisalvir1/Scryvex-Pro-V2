import { MediaStreamConfiguration, MediaStreamOptions, Setting } from "@scrypted/sdk";
import { autoconfigureCodecs as ac } from '../../../common/src/autoconfigure-codecs';
import { UrlMediaStreamOptions, scoreHomeKitStream } from "../../ffmpeg-camera/src/common";
import { OnvifCameraAPI } from "./onvif-api";

export function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

const onvifToFfmpegVideoCodecMap: { [key: string]: string } = {
    'h264': 'h264',
    'h265': 'h265',
    'hevc': 'h265',
};

const onvifToFfmpegAudioCodecMap: { [key: string]: string } = {
    'MP4A-LATM': 'aac',
    'aac': 'aac',
    'PCMU': 'pcm_mulaw',
    'PCMA': 'pcm_alaw',
};

const ffmpegToOnvifAudioCodecMap: { [key: string]: string } = {
    'aac': 'MP4A-LATM',
    'pcm_mulaw': 'PCMU',
    'pcm_alaw': 'PCMA',
};

export function fromOnvifAudioCodec(codec: string) {
    codec = codec?.toLowerCase();
    return onvifToFfmpegAudioCodecMap[codec] || codec;
}

export function fromOnvifVideoCodec(codec: string) {
    codec = codec?.toLowerCase();
    return onvifToFfmpegVideoCodecMap[codec] || codec;
}

export function toOnvifAudioCodec(codec: string) {
    for (const [key, value] of Object.entries(onvifToFfmpegAudioCodecMap)) {
        if (value === codec)
            return key;
    }
    return codec;
}

export function toOnvifVideoCodec(codec: string) {
    for (const [key, value] of Object.entries(onvifToFfmpegVideoCodecMap)) {
        if (value === codec)
            return key;
    }
    return codec;
}

export function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

export async function autoconfigureSettings(console: Console, client: OnvifCameraAPI) {
    return ac(
        () => getCodecs(console, client),
        (options) => configureCodecs(console, client, options)
    );
}

export async function configureCodecs(console: Console, client: OnvifCameraAPI, options: MediaStreamOptions): Promise<MediaStreamConfiguration> {
    if (!await client.canConfigureEncoding())
        console.warn('This camera may not support encoding configuration. Proceeding anyways.');

    client.profiles = undefined as any;
    const profiles: any[] = await client.getProfiles();
    const profile = profiles.find(profile => profile.$.token === options.id);

    const vc = profile.videoEncoderConfiguration;
    const ac = profile.audioEncoderConfiguration;

    const originalVideo = JSON.stringify(vc);
    const originalAudio = JSON.stringify(ac);

    const { video: videoOptions, audio: audioOptions } = options;

    if (videoOptions?.codec) {
        let key: string | undefined;
        switch (videoOptions.codec) {
            case 'h264':
                key = 'H264';
                break;
            case 'h265':
                key = 'H265';
                break;
        }
        if (key) {
            vc.encoding = key;

            if (videoOptions?.keyframeInterval) {
                vc[key] ||= {};
                vc[key].govLength = videoOptions?.keyframeInterval;
            }
            if (videoOptions?.profile) {
                let profile: string | undefined;
                switch (videoOptions.profile) {
                    case 'baseline':
                        profile = 'Baseline';
                        break;
                    case 'main':
                        profile = 'Main';
                        break;
                    case 'high':
                        profile = 'High';
                        break;
                }
                if (profile) {
                    vc[key] ||= {};
                    vc[key].profile = profile;
                }
            }
        }
    }

    if (videoOptions?.width && videoOptions?.height) {
        vc.resolution ||= {};
        vc.resolution.width = videoOptions?.width;
        vc.resolution.height = videoOptions?.height;
    }

    if (videoOptions?.bitrate) {
        vc.rateControl ||= {};
        vc.rateControl.bitrateLimit = Math.floor(videoOptions?.bitrate / 1000);
    }

    if (videoOptions?.fps) {
        vc.rateControl ||= {};
        vc.rateControl.frameRateLimit = videoOptions?.fps;
        vc.rateControl.encodingInterval = 1;
    }

    // onvif on amcrest seems to get upset if rateControl is not filled out
    // so try to avoid no op.
    if (JSON.stringify(vc) !== originalVideo)
        await client.setVideoEncoderConfiguration(vc);
    

    if (ac) {
        if (audioOptions?.codec)
            ac.encoding = toOnvifAudioCodec(audioOptions.codec);
        if (audioOptions?.bitrate)
            ac.bitrate = Math.floor(audioOptions?.bitrate / 1000);
        if (audioOptions?.sampleRate)
            ac.sampleRate = audioOptions.sampleRate / 1000;

        if (JSON.stringify(ac) !== originalAudio)
            await client.setAudioEncoderConfiguration(ac);
    }

    const configuredVideo = await client.getVideoEncoderConfigurationOptions(profile.$.token, vc.$.token);
    client.profiles = undefined as any;
    const ret: MediaStreamConfiguration = {
        id: options.id,
        video: {
            ...configuredVideo,
        }
    };

    // can't be set by onvif. But see if it is settable and doesn't match to direct user.
    if (videoOptions?.bitrateControl && vc.rateControl?.$?.ConstantBitRate !== undefined) {
        const constant = videoOptions?.bitrateControl === 'constant';
        if (vc.rateControl.$.ConstantBitRate !== constant)
            throw new Error(options.id + ': camera video Bitrate Type must be manually set to ' + videoOptions?.bitrateControl + ' in the camera web admin.');
    }

    return ret;
}

export async function getCodecs(console: Console, client: OnvifCameraAPI) {
    const profiles: any[] = await client.getProfiles();
    const ret: UrlMediaStreamOptions[] = [];
    for (const { $, name, videoEncoderConfiguration, audioEncoderConfiguration } of profiles) {
        try {
            const rawCodec: string = videoEncoderConfiguration?.encoding;
            const ffmpegCodec = fromOnvifVideoCodec(rawCodec);
            const isH264 = ffmpegCodec === 'h264';

            ret.push({
                id: $.token,
                metadata: {
                    videoId: videoEncoderConfiguration?.$?.token,
                    audioId: audioEncoderConfiguration?.$?.token,
                },
                name: name,
                container: 'rtsp',
                url: await client.getStreamUrl($.token),
                // Raw codec preserved so scoring and remux decisions are accurate
                // even when the normalised codec string may be coerced later.
                sourceCodec: rawCodec ? rawCodec.toLowerCase() : undefined,
                // H.264 streams can be forwarded to HomeKit without re-encoding video.
                directRemux: isH264,
                video: {
                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                    width: videoEncoderConfiguration?.resolution?.width,
                    height: videoEncoderConfiguration?.resolution?.height,
                    codec: ffmpegCodec,
                    keyframeInterval: videoEncoderConfiguration?.$?.GovLength,
                    bitrateControl: videoEncoderConfiguration?.rateControl?.$?.ConstantBitRate != null
                        ? (videoEncoderConfiguration?.rateControl?.$.ConstantBitRate ? 'constant' : 'variable')
                        : undefined,
                },
                audio: {
                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                    codec: fromOnvifAudioCodec(audioEncoderConfiguration?.encoding),
                }
            })
        }
        catch (e) {
            console.error('error retrieving onvif profile', $.token, e);
        }
    }

    // Sort profiles by HomeKit compatibility (H.264 first, then by resolution).
    // The highest-scoring H.264 profile gets flagged as homekitPreferred so
    // downstream plugins and HomeKit can identify it without re-scoring.
    ret.sort((a, b) => scoreHomeKitStream(b) - scoreHomeKitStream(a));

    const bestH264 = ret.find(s => s.video?.codec === 'h264' || s.sourceCodec?.includes('h264'));
    if (bestH264) {
        bestH264.homekitPreferred = true;
        console.log(`[onvif] HomeKit preferred stream: ${bestH264.name} (${bestH264.video?.codec}, ${bestH264.video?.width}x${bestH264.video?.height})`);
    } else {
        // No H.264 profile found; mark the best available stream so HomeKit
        // can at least attempt delivery (with fallback transcoding if needed).
        if (ret[0]) {
            ret[0].homekitPreferred = true;
            console.warn(`[onvif] No H.264 profile found. Marking ${ret[0].name} (${ret[0].video?.codec}) as HomeKit preferred — transcoding may be required.`);
        }
    }

    return ret;
}

