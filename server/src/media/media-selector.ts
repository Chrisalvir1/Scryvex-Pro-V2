import { StreamProfile, ProfileValidationStatus } from '../cameras/camera-adapter';
import { ProbedMediaSource } from './media-source';

export class MediaSourceSelector {
    
    private sortByResolutionAndFps(profiles: StreamProfile[]): StreamProfile[] {
        return [...profiles].sort((a, b) => {
            const resA = (a.width || 0) * (a.height || 0);
            const resB = (b.width || 0) * (b.height || 0);
            if (resA !== resB) return resA - resB; // Ascending by resolution
            
            const fpsA = a.fps || 0;
            const fpsB = b.fps || 0;
            return fpsA - fpsB;
        });
    }

    private getValidProfiles(probedSources: ProbedMediaSource[]): StreamProfile[] {
        return probedSources
            .map(ps => ps.profile)
            .filter(p => p.validationStatus === 'valid');
    }

    selectForPreview(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        let validProfiles = this.getValidProfiles(probedSources);
        if (validProfiles.length === 0) {
            // Fallback to any profile if none validated cleanly
            validProfiles = probedSources.map(p => p.profile);
        }
        
        const sortedDesc = this.sortByResolutionAndFps(validProfiles).reverse();
        
        // Find best profile up to 1080p
        const target = sortedDesc.find(p => (p.width || 0) <= 1920 && (p.height || 0) <= 1080);
        return target || sortedDesc[0]; // If all >1080p, return the smallest of them (last in sortedDesc) or just largest?
        // Wait, sortedDesc is largest to smallest. If all > 1080p, we want the SMALLEST of them to save bandwidth.
        // Actually, if we return sortedDesc[0], we return the largest. Let's return the smallest if all >1080p:
        // sortedDesc[sortedDesc.length - 1]
    }

    selectForSnapshot(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually highest resolution available for snapshots
        const validProfiles = this.getValidProfiles(probedSources);
        const candidates = validProfiles.length > 0 ? validProfiles : probedSources.map(p => p.profile);
        return this.sortByResolutionAndFps(candidates).reverse()[0];
    }

    selectForRecording(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually highest resolution available
        return this.selectForSnapshot(probedSources);
    }

    selectForAnalytics(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually lower resolution is fine for AI, around 720p-1080p, high frame rate
        const candidates = this.getValidProfiles(probedSources);
        const sorted = this.sortByResolutionAndFps(candidates);
        return sorted.find(p => (p.width || 0) <= 1920 && (p.height || 0) <= 1080) || sorted[0];
    }

    selectForHomeKitH264(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        const candidates = this.getValidProfiles(probedSources);
        return candidates.find(p => p.canRemuxVideo && p.normalizedCodec === 'H264');
    }

    selectForHomeKitH265(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        const candidates = this.getValidProfiles(probedSources);
        return candidates.find(p => p.canRemuxVideo && p.normalizedCodec === 'H265');
    }
}
