export interface AppIdentityOptions {
    file: string;
    log?: (message: string) => void;
    flushDelayMs?: number;
}
export declare class AppIdentity {
    private readonly options;
    private readonly apps;
    /** The App ID this file last saw; a different one means an identity switch. */
    private lastAppId;
    /** The ids that were configured the last time we looked (previous run). */
    private lastIds;
    private loaded;
    private dirty;
    private timer?;
    private writing;
    constructor(options: AppIdentityOptions);
    load(): Promise<void>;
    /**
     * Record the ids as belonging to `appId`, and notice an identity switch.
     *
     * Two things happen here, in this order:
     *   1. If the App ID differs from the one on disk, every id currently in the
     *      allowlists is stamped with the OLD app — that is exactly what they are:
     *      ids issued for the previous bot. Doing this BEFORE recording is what
     *      makes the very first run of a switched profile still flag them.
     *   2. Ids never seen before are recorded under the current app.
     *
     * @param ids - open_ids currently configured
     * @param appId - the App ID this process is using now
     */
    observe(ids: readonly string[], appId: string): void;
    /** Backwards-compatible alias for {@link observe}. */
    remember(ids: readonly string[], appId: string): void;
    /** The App ID recorded by the last call to {@link observe}. */
    get appId(): string;
    /**
     * The ids that belong to a DIFFERENT app than the one now configured.
     *
     * @param ids - open_ids to check
     * @param appId - the App ID this process is configured with
     * @returns stale id → its app id, for exactly the ids that changed hands
     */
    staleAmong(ids: readonly string[], appId: string): Record<string, string>;
    /** The current app id, per the stored history (for diagnostics). */
    get size(): number;
    private schedule;
    flush(): Promise<void>;
}
