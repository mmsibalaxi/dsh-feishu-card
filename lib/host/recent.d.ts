/** One sender the bot has seen. */
export interface SeenSender {
    openId: string;
    chatId: string;
    /** Last time this person was heard from (epoch ms). */
    at: number;
    /** How many messages seen from them, so a repeat sender sorts higher. */
    count: number;
}
export interface RecentContactsOptions {
    /** JSON file holding the ring; its directory is created on first save. */
    file: string;
    /** How many senders to keep. */
    limit?: number;
    log?: (message: string) => void;
}
/**
 * A bounded, persisted list of recent senders.
 *
 * Order is "most recently heard from first"; a repeat sender moves to the front
 * instead of appending, so the list stays a usable shortlist rather than a log.
 */
export declare class RecentContacts {
    private readonly options;
    private readonly senders;
    private readonly limit;
    private loaded;
    private saveTimer;
    constructor(options: RecentContactsOptions);
    /** Read the persisted ring; a missing or corrupt file just starts empty. */
    load(): Promise<void>;
    /** Record one inbound message's sender. Cheap: in-memory, save is debounced. */
    note(openId: string, chatId: string, at?: number): void;
    /** Recent senders, newest first. */
    list(): SeenSender[];
    /** Distinct chats seen recently, newest first — the group allowlist's shortcut. */
    chats(): {
        chatId: string;
        at: number;
    }[];
    /** Write now, cancelling any pending debounce (used by tests and shutdown). */
    flush(): Promise<void>;
    private trim;
    private scheduleSave;
}
