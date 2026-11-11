/**
 * The one same-origin HTTP route the settings panel uses: the model list.
 *
 * Why HTTP and not a Typert Remote namespace: the panel runs in the renderer,
 * and `ctx.llm.listModels` is not a `@Remote` method, so the browser cannot call
 * it directly. The Host already serves the GUI itself, so one exact route on
 * `webServer` is reachable from the panel with a plain
 * `fetch('/api/feishu-card/models')` — no new dependency, no CORS.
 *
 * Contact/group lookups used to live here too and were removed: Feishu will not
 * let a bot search the directory by name (`search/v1/user` needs a
 * user_access_token), and this app's 通讯录 data scope is a single person, so
 * the picker could only ever show one row. Manual id entry plus a hint is
 * honest about that; see references/panel-rules.md §12.5.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ModelCatalog } from './models.ts';
export declare const MODELS_PATH = "/api/feishu-card/models";
export declare const RECENT_PATH = "/api/feishu-card/recent";
export declare const AUTH_PATH = "/api/feishu-card/auth";
export declare const SEARCH_PATH = "/api/feishu-card/search";
export declare const NAMES_PATH = "/api/feishu-card/names";
export declare const CHAT_SEARCH_PATH = "/api/feishu-card/chat-search";
/** One sender the bot has heard from, as the panel's shortcut row shows it. */
export interface RecentEntry {
    openId: string;
    chatId: string;
    at: number;
    count: number;
}
/** What the routes need from the plugin's host side. */
export interface PanelRouteDeps {
    listModels(): Promise<ModelCatalog>;
    /** People and chats the bot has already seen — needs no Feishu permission. */
    recent(): {
        people: RecentEntry[];
        chats: {
            chatId: string;
            at: number;
        }[];
    };
    /** Delegated (user-token) directory search; see directory.ts. */
    directory: {
        state(): {
            authorized: boolean;
            needAuth?: boolean;
            userName?: string;
            pending?: unknown;
            error?: string;
        };
        begin(): Promise<{
            authorized: boolean;
            userName?: string;
            pending?: unknown;
            error?: string;
        }>;
        poll(): Promise<{
            authorized: boolean;
            userName?: string;
            pending?: unknown;
            error?: string;
        }>;
        forget(): Promise<void>;
        search(query: string): Promise<{
            people: {
                openId: string;
                name: string;
            }[];
            error?: string;
        }>;
    };
    /**
     * Display names for stored ids, split by kind.
     *
     * Users come from the delegated token (cached on disk), chats from the bot's
     * own identity — so a group chip keeps its name even when the person's
     * authorisation has expired.
     */
    names: {
        users(ids: readonly string[]): Promise<{
            names: Record<string, string>;
            error?: string;
        }>;
        chats(ids: readonly string[]): Promise<Record<string, string>>;
        /** Group search by name, on the BOT's identity (no delegated token needed). */
        chatSearch(query: string): Promise<{
            chats: {
                chatId: string;
                name: string;
            }[];
            error?: string;
        }>;
    };
}
/** The slice of node's http types these handlers touch (keeps tests fake-free). */
export interface RouteRequest {
    method?: string;
    url?: string;
}
export interface RouteResponse {
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(body?: string): unknown;
}
/**
 * Answer the model-list request. Never throws: a failure is a JSON body the
 * panel renders as a hint, which is all the person configuring it can act on.
 */
export declare function handlePanelRequest(req: RouteRequest, res: RouteResponse, deps: PanelRouteDeps): Promise<void>;
/**
 * Mount the route for as long as the plugin is loaded.
 *
 * `ctx.inject(['webServer'], …)` rather than `ctx.get('webServer')`: our plugin
 * activates before the `webserver` row does, so a direct read returns undefined
 * and the route silently never mounts (verified live — the request fell through
 * to the connection package's `/api` prefix route and answered `404 not found`).
 * `ctx.inject` defers the callback until the service exists and drops it when
 * the providing plugin unloads, which is exactly the lifetime we want.
 */
export declare function registerPanelRoutes(ctx: Context, deps: PanelRouteDeps, log?: (message: string) => void): void;
