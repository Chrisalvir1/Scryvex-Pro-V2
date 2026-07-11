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
        const validProfiles = this.getValidProfiles(probedSources);
        if (validProfiles.length === 0) return undefined;
        
        const sortedDesc = this.sortByResolutionAndFps(validProfiles).reverse();
        
        // Find best profile up to 1080p
        const target = sortedDesc.find(p => (p.width || 0) <= 1920 && (p.height || 0) <= 1080);
        return target || sortedDesc[sortedDesc.length - 1]; // Return smallest if all >1080p
    }

    selectForSnapshot(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually highest resolution available for snapshots
        const validProfiles = this.getValidProfiles(probedSources);
        if (validProfiles.length === 0) return undefined;
        
        return this.sortByResolutionAndFps(validProfiles).reverse()[0];
    }

    selectForRecording(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually highest resolution available
        return this.selectForSnapshot(probedSources);
    }

    selectForAnalytics(probedSources: ProbedMediaSource[]): StreamProfile | undefined {
        // Usually lower resolution is fine for AI, around 720p-1080p, high frame rate
        const candidates = this.getValidProfiles(probedSources);
        if (candidates.length === 0) return undefined;
        
        const sorted = this.sortByResolutionAndFps(candidates);
        return sorted.find(p => (p.width || 0) <= 1920 && (p.height || 0) <= 1080) || sorted[sorted.length - 1]; // Fallback to smallest if all >1080p
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
