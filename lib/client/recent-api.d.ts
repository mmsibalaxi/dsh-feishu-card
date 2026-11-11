/**
 * The panel's side of the "people the bot has already heard from" route.
 *
 * Kept apart from the component so the wire contract is unit-tested without a
 * DOM.
 */
export declare const RECENT_PATH = "/api/feishu-card/recent";
/** One sender the bot has seen, as the shortcut row shows it. */
export interface RecentPerson {
    openId: string;
    chatId: string;
    at: number;
    count: number;
}
export interface RecentChat {
    chatId: string;
    at: number;
}
export interface RecentSnapshot {
    people: RecentPerson[];
    chats: RecentChat[];
}
/** Coerce the Host's answer; anything malformed is simply left out. */
export declare function parseRecent(payload: unknown): RecentSnapshot;
/** `3 分钟前` / `2 天前` — enough to tell fresh from stale. */
export declare function agoText(at: number, now?: number): string;
