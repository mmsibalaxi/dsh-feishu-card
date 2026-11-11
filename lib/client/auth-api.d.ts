/**
 * The panel's side of "search the directory as me".
 *
 * Wire contract only; the component drives it. Kept separate so the parsing is
 * unit-tested without a DOM.
 */
export declare const AUTH_PATH = "/api/feishu-card/auth";
export declare const SEARCH_PATH = "/api/feishu-card/search";
export declare const NAMES_PATH = "/api/feishu-card/names";
export declare const CHAT_SEARCH_PATH = "/api/feishu-card/chat-search";
/** What the panel needs to render the authorisation state. */
export interface AuthState {
    authorized: boolean;
    /**
     * The stored token can no longer work (expired and unrefreshable).
     *
     * The panel then shows 「授权已过期，重新授权」 instead of a search box that
     * returns a token error on every query.
     */
    needAuth?: boolean;
    userName?: string;
    pending?: {
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresAt: number;
    };
    error?: string;
}
/** One person found by the delegated search. */
export interface FoundPerson {
    openId: string;
    name: string;
}
/** One group found by the bot-identity search. */
export interface FoundChat {
    chatId: string;
    name: string;
}
export declare function authUrl(action: 'state' | 'begin' | 'poll' | 'forget'): string;
export declare function searchUrl(query: string): string;
/** Keyword search over the groups the bot can see (no delegated token needed). */
export declare function chatSearchUrl(query: string): string;
/** Ask the Host to resolve open_ids to names (comma-separated, like the allowlist). */
export declare function namesUrl(ids: readonly string[]): string;
/**
 * Coerce a names answer into one id → name map.
 *
 * The Host answers with two buckets because people and chats resolve through
 * different credentials; ids are disjoint by prefix (ou_ / oc_), so the panel can
 * treat them as one map.
 */
export declare function parseNames(payload: unknown): Record<string, string>;
/** Coerce the authorisation answer. */
export declare function parseAuth(payload: unknown): AuthState;
/** Coerce a search answer. */
export declare function parseFound(payload: unknown): {
    people: FoundPerson[];
    error?: string;
};
/** Coerce a group-search answer. */
export declare function parseFoundChats(payload: unknown): {
    chats: FoundChat[];
    error?: string;
};
