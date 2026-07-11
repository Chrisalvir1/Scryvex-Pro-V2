export type EntityState = 'disabled' | 'selected' | 'published' | 'detected_by_controller' | 'verified' | 'failed';

export interface MatterEntity {
    id: string; // e.g. "motion", "live_video"
    name: string;
    state: EntityState;
    clusterId?: number; // Optional Matter cluster id reference
}

export interface CameraExposureConfig {
    cameraId: string;
    alias: string;
    entities: Record<string, MatterEntity>;
}

export class ExposureManifest {
    private entities = new Map<string, MatterEntity>();

    constructor(private readonly config: CameraExposureConfig) {
        if (config.entities) {
            for (const [key, val] of Object.entries(config.entities)) {
                this.entities.set(key, val);
            }
        }
    }

    addEntity(id: string, name: string, initialState: EntityState = 'disabled', clusterId?: number) {
        if (!this.entities.has(id)) {
            this.entities.set(id, { id, name, state: initialState, clusterId });
        }
    }

    setEntityState(id: string, state: EntityState) {
        const entity = this.entities.get(id);
        if (entity) {
            entity.state = state;
            this.entities.set(id, entity);
        }
    }

    getEntity(id: string) {
        return this.entities.get(id);
    }

    getAll(): MatterEntity[] {
        return Array.from(this.entities.values());
    }

    toJSON(): CameraExposureConfig {
        const ents: Record<string, MatterEntity> = {};
        for (const [key, val] of this.entities.entries()) {
            ents[key] = val;
        }
        return {
            cameraId: this.config.cameraId,
            alias: this.config.alias,
            entities: ents,
        };
    }
}
