import type { Brand } from '../shared/types.js';
import type { NameBook } from './names.ts';
export interface DirectoryOptions {
    read: () => {
        appId: string;
        appSecret: string;
        brand: Brand;
    };
    /** Where to persist the delegated token. */
    file: string;
    /**
     * Disk-backed id → name cache.
     *
     * Optional so the class stays usable alone (tests), but the panel always
     * passes one: without it every DSH restart loses every name and the settings
     * page goes back to showing raw `ou_…` ids.
     */
    names?: NameBook;
    log?: (message: string) => void;
    /** Injectable for tests: the HTTP layer the device flow and search use. */
    fetch?: typeof fetch;
    now?: () => number;
}
/** What the panel shows while an authorisation is in flight. */
export interface PendingAuth {
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    /** Epoch ms when this request stops being useful. */
    expiresAt: number;
}
/** One person found by name. */
export interface FoundPerson {
    openId: string;
    name: string;
    departmentIds?: string[];
}
/** The state the panel renders for the "search as me" feature. */
export interface DirectoryState {
    /** Whether a usable delegated token is held (or can be refreshed on demand). */
    authorized: boolean;
    /**
     * True when the held token can no longer work and the person must authorise
     * again. The panel shows a 重新授权 button instead of the search box, which is
     * what makes an expired delegation self-explanatory instead of "搜索报错".
     */
    needAuth?: boolean;
    /** The person who authorised, when known. */
    userName?: string;
    /** An in-flight authorisation the panel should show. */
    pending?: PendingAuth;
    /** Why authorisation is unavailable (no credentials, scope missing, …). */
    error?: string;
}
/**
 * Holds one delegated token, refreshes it when needed, and searches the
 * directory with it.
 *
 * One instance per plugin: the token is a property of the *person*, not of a
 * request, so it outlives the panel page.
 */
export declare class DirectorySearch {
    private readonly options;
    private token;
    private pending;
    private polling;
    private loaded;
    /**
     * Set when a refresh was actually attempted and failed.
     *
     * A dead refresh token is not the same as a network blip: without this flag
     * the panel kept claiming "authorized" for days while every search returned a
     * token error (live report 2026-11-10: 搜索报错，断开重连授权才行).
     */
    private refreshFailed;
    constructor(options: DirectoryOptions);
    /** Load a previously stored token; a missing file is not an error. */
    load(): Promise<void>;
    /** Current state, without touching the network. */
    state(): DirectoryState;
    /**
     * Begin an authorisation. Returns the code and link for the panel to show;
     * `complete()` then polls until the person confirms.
     */
    begin(): Promise<DirectoryState>;
    /**
     * Poll once. Called by the panel every few seconds while it shows the code.
     *
     * Concurrent calls share one request: the panel may re-render faster than the
     * network answers, and Feishu rate-limits polling.
     */
    poll(): Promise<DirectoryState>;
    /** Forget the delegation (the panel's "断开" button). */
    forget(): Promise<void>;
    /** Search people by name, e-mail or open_id. Needs a live delegated token. */
    search(query: string): Promise<{
        people: FoundPerson[];
        error?: string;
    }>;
    /**
     * Resolve open_ids to names, so a chip can read `ou_0000… (张三)`.
     *
     * Runs on the delegated token for the same reason search does: with the
     * tenant token this app can only see one person, so every other id would come
     * back `41050 no authority`. It doubles as an id check — a real id resolves,
     * a made-up one does not.
     *
     * Results are cached per id (names rarely change, and the panel asks on every
     * refresh), and unknown ids are simply absent from the map.
     */
    names(ids: readonly string[]): Promise<{
        names: Record<string, string>;
        error?: string;
    }>;
    /** A token that will work right now, refreshing it if it is about to expire. */
    private usableToken;
    private store;
}
