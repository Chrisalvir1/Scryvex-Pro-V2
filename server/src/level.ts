import { Client, Pool } from 'pg';
import { EventEmitter } from 'events';

export interface LevelDocument {
    _id: any;
    _documentType: string;
}

export interface LevelDocumentConstructor<T extends LevelDocument> {
    new(): T;
}

function createLevelDocument(documentConstructor: any, json: any) {
    const doc = new documentConstructor();
    Object.assign(doc, JSON.parse(json));
    return doc;
}

export class WrappedLevel extends EventEmitter {
    curId!: number;
    pool: Pool;

    constructor(dbPath: string) {
        super();
        // Uses connection string from env or falls back
        const connectionString = process.env.DATABASE_URL || 'postgresql://localhost/scryvex';
        this.pool = new Pool({ connectionString });
    }

    async open(): Promise<void> {
        await this.pool.query('CREATE SCHEMA IF NOT EXISTS scryvex_core');
        await this.pool.query('CREATE TABLE IF NOT EXISTS scryvex_core.keyvalue (key TEXT PRIMARY KEY, value TEXT)');
        
        try {
            const res = await this.pool.query('SELECT value FROM scryvex_core.keyvalue WHERE key = $1', ['_id']);
            if (res.rows.length > 0) {
                this.curId = parseInt(res.rows[0].value);
            }
        } catch (e) {
        }
        if (!this.curId) this.curId = 0;
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    async get(key: string, options?: any): Promise<string> {
        const res = await this.pool.query('SELECT value FROM scryvex_core.keyvalue WHERE key = $1', [key]);
        if (res.rows.length === 0) throw new Error('NotFound');
        return res.rows[0].value;
    }

    async put(key: string, value: any, options?: any): Promise<void> {
        await this.pool.query(
            'INSERT INTO scryvex_core.keyvalue (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [key, String(value)]
        );
    }

    async del(key: string): Promise<void> {
        await this.pool.query('DELETE FROM scryvex_core.keyvalue WHERE key = $1', [key]);
    }

    async *iterator(): AsyncIterable<[string, string]> {
        const client = await this.pool.connect();
        try {
            const res = await client.query('SELECT key, value FROM scryvex_core.keyvalue');
            for (const row of res.rows) {
                yield [row.key, row.value];
            }
        } finally {
            client.release();
        }
    }

    async tryGet<T>(documentConstructor: new () => T, _id: any, options?: any): Promise<T | undefined> {
        try {
            const _documentType = documentConstructor.name;
            const key = `${_documentType}/${_id}`;
            const json = await this.get(key, options);
            return createLevelDocument(documentConstructor, json);
        } catch (e) {
            return undefined;
        }
    }

    async* getAll(documentConstructor: any): AsyncIterable<any> {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        for await (const [key, value] of this.iterator()) {
            if (key.startsWith(prefix)) {
                const doc = createLevelDocument(documentConstructor, value);
                if (doc._documentType === _documentType) {
                    yield doc;
                }
            }
        }
    }

    async getCount(documentConstructor: any) {
        let count = 0;
        for await (const doc of this.getAll(documentConstructor)) {
            count++;
        }
        return count;
    }

    nextId() {
        if (typeof this.curId !== 'number') throw new Error('curId is not a number');
        return ++this.curId;
    }

    async saveId() {
        return this.put("_id", this.curId);
    }

    async upsert(value: LevelDocument, options?: any): Promise<any> {
        const _documentType = value.constructor.name;
        if (!value._id) value._id = this.nextId();
        await this.saveId();
        value._documentType = _documentType;
        const key = `${_documentType}/${value._id}`;
        await this.put(key, JSON.stringify(value), options);
        return value;
    }

    async remove(value: LevelDocument) {
        const _documentType = value.constructor.name;
        let { _id } = value;
        const key = `${_documentType}/${_id}`;
        await this.del(key);
    }

    async removeId(documentConstructor: LevelDocumentConstructor<any>, _id: any) {
        const _documentType = documentConstructor.name;
        const key = `${_documentType}/${_id}`;
        await this.del(key);
    }

    async removeAll(documentConstructor: LevelDocumentConstructor<any>) {
        const _documentType = documentConstructor.name;
        const prefix = `${_documentType}/`;
        for await (const [key, value] of this.iterator()) {
            if (key.startsWith(prefix)) {
                const doc = createLevelDocument(documentConstructor, value);
                if (doc._documentType === _documentType) {
                    await this.del(key);
                }
            }
        }
    }
}

export default WrappedLevel;
