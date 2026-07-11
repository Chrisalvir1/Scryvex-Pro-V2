import { StreamProfile, RawStreamInfo, normalizeCodec } from '../cameras/camera-adapter';

export interface HomeKitStreamMode {
    selectedMode: 'hevc-remux' | 'h264-remux' | 'hevc-transcode' | 'h264-transcode' | 'auto' | 'disabled';
    sourceProfileId?: string;
    video: {
        input: string;
        output: string;
        operation: 'copy' | 'transcode';
    };
    audio: {
        input: string;
        output: string;
        operation: 'copy' | 'transcode';
    };
    reason?: string;
}

export interface HomeKitCompatibilityMatrix {
    cameraId: string;
    videoTiers: {
        highest?: StreamProfile;
        high?: StreamProfile;
        medium?: StreamProfile;
        low?: StreamProfile;
    };
    remuxOptions: {
        canRemuxH265: boolean;
        canRemuxH264: boolean;
        sourceProfileIdH265?: string;
        sourceProfileIdH264?: string;
    };
    audioOptions: {
        sourceCodec?: string;
        canRemuxOpus: boolean;
        requiresTranscodeToOpus: boolean;
    };
    recommendedMode: HomeKitStreamMode['selectedMode'];
    meetsNewAppleRequirements: boolean;
    reasons: string[];
}

/**
 * Evaluates the stream profiles to determine compatibility with HomeKit Secure Video
 * based on the new Apple specifications (Opus audio, HEVC/H.264 support).
 */
export function evaluateHomeKitCompatibility(cameraId: string, profiles: StreamProfile[]): HomeKitCompatibilityMatrix {
    const reasons: string[] = [];
    const matrix: HomeKitCompatibilityMatrix = {
        cameraId,
        videoTiers: {},
        remuxOptions: { canRemuxH264: false, canRemuxH265: false },
        audioOptions: { canRemuxOpus: false, requiresTranscodeToOpus: true },
        recommendedMode: 'auto',
        meetsNewAppleRequirements: false,
        reasons
    };

    if (!profiles || profiles.length === 0) {
        reasons.push('No hay perfiles de video disponibles.');
        matrix.recommendedMode = 'disabled';
        return matrix;
    }

    // 1. Audio Evaluation
    const mainAudioProfile = profiles.find(p => p.audioCodec);
    if (mainAudioProfile?.audioCodec) {
        const audioCodec = normalizeCodec(mainAudioProfile.audioCodec).normalizedCodec;
        matrix.audioOptions.sourceCodec = audioCodec;
        
        if (audioCodec === 'OPUS') {
            // New Apple Spec requires 16kHz or 24kHz capture, 48kHz transmission.
            // If the camera is already Opus, we can *maybe* remux, but it's tricky due to packet sizes.
            // For safety, we will transcode unless we can verify it's exactly 16/24kHz and 20ms ptime.
            // Currently assuming transcode is safer for HKSV Opus compliance unless proven otherwise.
            matrix.audioOptions.canRemuxOpus = false;
            matrix.audioOptions.requiresTranscodeToOpus = true;
            reasons.push('Audio original Opus; se adaptará al formato estricto de HomeKit.');
        } else {
            matrix.audioOptions.canRemuxOpus = false;
            matrix.audioOptions.requiresTranscodeToOpus = true;
            reasons.push(`Audio original ${mainAudioProfile.displayCodec || audioCodec}; se transcodificará a Opus.`);
        }
    } else {
        reasons.push('No se detectó pista de audio. El stream no tendrá sonido en HomeKit.');
        matrix.audioOptions.requiresTranscodeToOpus = false;
    }

    // 2. Video Remux Capabilities
    const h265Profile = profiles.find(p => normalizeCodec(p.codec || '').normalizedCodec === 'H265');
    const h264Profile = profiles.find(p => normalizeCodec(p.codec || '').normalizedCodec === 'H264');

    if (h265Profile) {
        matrix.remuxOptions.canRemuxH265 = true;
        matrix.remuxOptions.sourceProfileIdH265 = h265Profile.id;
        h265Profile.canRemuxVideo = true;
    }
    
    if (h264Profile) {
        matrix.remuxOptions.canRemuxH264 = true;
        matrix.remuxOptions.sourceProfileIdH264 = h264Profile.id;
        h264Profile.canRemuxVideo = true;
    }

    // 3. Tiers Assignment (Highest, High, Medium, Low)
    // Find highest resolution
    let maxResProfile = profiles[0];
    let maxPixels = 0;
    
    for (const p of profiles) {
        if (p.width && p.height) {
            const pixels = p.width * p.height;
            if (pixels > maxPixels) {
                maxPixels = pixels;
                maxResProfile = p;
            }
        }
    }

    // 4K = ~8.2 million pixels (3840x2160)
    // 2K = ~3.6 million pixels (2560x1440)
    // 1080p = ~2.0 million pixels (1920x1080)
    
    if (maxPixels >= 8000000) {
        // It's a 4K camera. Can it do Highest? (Needs 4K and 2K simultaneous)
        const has2K = profiles.some(p => p.width && p.height && p.width >= 2560 && p.width < 3840);
        if (has2K) {
            matrix.videoTiers.highest = maxResProfile;
            matrix.videoTiers.high = profiles.find(p => p.width && p.height && p.width >= 2560 && p.width < 3840);
        } else {
            matrix.videoTiers.high = maxResProfile; // 4K becomes High
        }
        matrix.videoTiers.medium = profiles.find(p => p.width && p.width <= 1920) || maxResProfile;
    } else if (maxPixels >= 3000000) {
        // 2K Camera
        matrix.videoTiers.high = maxResProfile;
        matrix.videoTiers.medium = profiles.find(p => p.width && p.width <= 1920) || maxResProfile;
    } else {
        // 1080p or lower Camera
        matrix.videoTiers.high = maxResProfile;
        matrix.videoTiers.medium = profiles.find(p => p.width && p.width <= 1280) || maxResProfile;
    }
    
    matrix.videoTiers.low = profiles.find(p => p.width && p.width <= 640) || matrix.videoTiers.medium;

    // 4. Final Compliance and Recommendations
    if (matrix.remuxOptions.canRemuxH265) {
        matrix.recommendedMode = 'hevc-remux';
        matrix.meetsNewAppleRequirements = true;
        reasons.push('Cámara compatible con el nuevo nivel HEVC de HomeKit mediante Remux.');
    } else if (matrix.remuxOptions.canRemuxH264) {
        matrix.recommendedMode = 'h264-remux';
        matrix.meetsNewAppleRequirements = false; // Strictly speaking, new spec wants HEVC support, but H264 is backwards compatible.
        reasons.push('Cámara no soporta H.265 de forma nativa. Se usará H.264 Remux (compatible con versiones anteriores de HomeKit).');
    } else {
        matrix.recommendedMode = 'hevc-transcode';
        matrix.meetsNewAppleRequirements = true; // Meets it via transcode
        reasons.push('La cámara no provee H.264 o H.265. Se requiere transcodificación a H.265 (ALTO uso de CPU).');
    }

    return matrix;
}
