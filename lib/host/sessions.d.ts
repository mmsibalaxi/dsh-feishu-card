export interface SessionRecord {
    sessionId: string;
    workspace: string;
    updatedAt: number;
}
export declare class SessionStore {
    private readonly file;
    private sessions;
    private loaded;
    private writeChain;
    constructor(file: string);
    load(): Promise<void>;
    get(key: string): SessionRecord | undefined;
    keys(): string[];
    get size(): number;
    /** Record (or refresh) a session for a chat key and persist. */
    put(key: string, record: SessionRecord): Promise<void>;
    remove(key: string): Promise<void>;
    private enqueueFlush;
    private flush;
}
