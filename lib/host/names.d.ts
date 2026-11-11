import * as Lark from '@larksuiteoapi/node-sdk';
import type { Brand } from '../shared/types.js';
export interface NameBookOptions {
    /** Where the cache lives; one file for both kinds. */
    file: string;
    log?: (message: string) => void;
    /** Debounce for the disk write (a panel refresh can resolve 30 ids at once). */
    flushDelayMs?: number;
}
export declare class NameBook {
    private readonly options;
    private readonly users;
    private readonly chats;
    private loaded;
    private dirty;
    private timer?;
    private writing;
    private tmpSeq;
    constructor(options: NameBookOptions);
    /** Read the cache. A missing or corrupt file is simply an empty cache. */
    load(): Promise<void>;
    /** Cached name for any id, whichever kind it is. */
    lookup(id: string): string | undefined;
    user(id: string): string | undefined;
    chat(id: string): string | undefined;
    usersOf(ids: readonly string[]): Record<string, string>;
    chatsOf(ids: readonly string[]): Record<string, string>;
    /** Everything cached, for diagnostics (`scripts/probe-names.ts`). */
    snapshot(): {
        users: Record<string, string>;
        chats: Record<string, string>;
    };
    rememberUsers(names: Record<string, string>): void;
    rememberChats(names: Record<string, string>): void;
    /** Persist on the next tick; unref'd so a card/panel never holds the process. */
    private schedule;
    /** Write now (shutdown, tests). */
    flush(): Promise<void>;
}
/** The tenant-side chat reader: chat info, the bot's chat list, and search. */
export interface ChatNameReader {
    get(chatId: string): Promise<{
        code?: number;
        msg?: string;
        data?: {
            name?: string;
            chat_mode?: string;
        };
    }>;
    /** Every chat the bot is in; the fallback when `get` refuses one. */
    list?(): Promise<{
        code?: number;
        msg?: string;
        data?: {
            items?: ChatRow[];
        };
    }>;
    /** Keyword search over the chats the bot can see. */
    search?(query: string): Promise<{
        code?: number;
        msg?: string;
        data?: {
            items?: ChatRow[];
        };
    }>;
}
/** One chat row, as both `list` and `search` report it. */
export interface ChatRow {
    chat_id?: string;
    name?: string;
    chat_mode?: string;
}
export interface ChatNamesOptions {
    read: () => {
        appId: string;
        appSecret: string;
        brand: Brand;
    };
    /** Injection point for tests. */
    createClient?: (config: {
        appId: string;
        appSecret: string;
        domain: Lark.Domain;
    }) => ChatNameReader;
    /** Called with the names learned from search, so they reach the disk cache. */
    remember?: (names: Record<string, string>) => void;
    log?: (message: string) => void;
}
/**
 * Resolve group names with the BOT's identity.
 *
 * `GET /open-apis/im/v1/chats/{chat_id}` needs `im:chat:read` (granted) and only
 * works for chats the bot is in — which is exactly the set worth listing.
 * Deliberately independent of the delegated user token: group names must keep
 * working after a person's authorisation expires.
 */
export declare class ChatNames {
    private readonly options;
    private reader?;
    constructor(options: ChatNamesOptions);
    private client;
    /**
     * Resolve chat ids to names, skipping the ones already cached by the caller.
     *
     * `chats/{id}` is the precise call but it answers an error code for a chat the
     * bot left (or a p2p id it does not recognise), so a failed batch falls back to
     * ONE `chats.list` pass over everything the bot is in — the same names, one
     * request, and no `未知群` for a chat that is plainly visible in Feishu.
     *
     * Never throws: fewer names is fine, the panel has a neutral label for that.
     */
    resolve(ids: readonly string[]): Promise<Record<string, string>>;
    /**
     * Search the chats this bot can see by name.
     *
     * `im/v1/chats/search` is bot-identity, so it needs no delegated token: group
     * picking keeps working while a person's authorisation is expired.
     */
    search(query: string): Promise<{
        chats: {
            chatId: string;
            name: string;
        }[];
        error?: string;
    }>;
    private rememberSearch;
}
