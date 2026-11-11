import * as Lark from '@larksuiteoapi/node-sdk';
import type { Context } from '@deepseek-ai/cordis';
import type { TurnEnd } from './bridge.ts';
import { FeishuGateway, type GatewayOptions } from './gateway.ts';
import { type RawFeishuMessage } from './messages.ts';
import { FeishuSender, type SenderOptions } from './sender.ts';
import { FeishuReactor, type ReactionOptions } from './reaction.ts';
import { FeishuQuoteFetcher, type QuoteOptions } from './quote.ts';
import { LarkCardTransport, type LarkCardTransportOptions } from './card/transport.ts';
import { type BotInfoReader } from './bot.ts';
import { RecentContacts, type SeenSender } from './recent.ts';
import type { ResolvedConfig } from './config.ts';
export interface FeishuCardRuntime {
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Drive one raw Feishu message through the whole pipeline. */
    inbound(raw: RawFeishuMessage): Promise<void>;
    /** People the bot has already seen, newest first (panel shortcut row). */
    recent(): SeenSender[];
    /** Chats the bot has already seen, newest first (panel shortcut row). */
    recentChats(): {
        chatId: string;
        at: number;
    }[];
    status(): {
        connected: boolean;
        sessions: number;
        allowlist: number;
        groupAllowlist: number;
    };
}
/** Injection points for tests (and future non-Lark transports). */
export interface RuntimeDeps {
    createGateway?: (options: GatewayOptions) => FeishuGateway;
    createSender?: (options: SenderOptions) => FeishuSender;
    createCardTransport?: (options: LarkCardTransportOptions) => LarkCardTransport;
    createReactor?: (options: ReactionOptions) => FeishuReactor;
    /** Quoted-message reader; injected in tests. */
    createQuote?: (options: QuoteOptions) => FeishuQuoteFetcher;
    /**
     * Bot-info reader, so "was I mentioned?" needs no live call in tests.
     *
     * Resolving the bot's own open_id is what keeps `@李四` from waking this bot
     * in a group; without an injected reader every group message pays one HTTP
     * round trip (cached per app, but a test has no app).
     */
    createBotReader?: (config: {
        appId: string;
        appSecret: string;
        domain: Lark.Domain;
    }) => BotInfoReader;
    /**
     * Reverse name lookup for the `[发送人 姓名 (open_id)]` header.
     *
     * The panel's `DirectorySearch` is passed in: it runs on the delegated user
     * token (the tenant token can only see one person) and caches per id, so an
     * unauthorized profile simply yields no name instead of a broken header.
     */
    directory?: {
        names(ids: readonly string[]): Promise<{
            names: Record<string, string>;
            error?: string;
        }>;
    };
    /**
     * Disk-backed id → name cache.
     *
     * Used by the message header so `[发送人 张三]` keeps working after the
     * delegated token expires: the last known name is better than a bare open_id.
     */
    names?: {
        user(id: string): string | undefined;
        rememberUsers(names: Record<string, string>): void;
    };
    /** Shared with the panel's shortcut route when supplied. */
    recent?: RecentContacts;
}
/**
 * Whether a finished turn still needs its answer posted as a plain text message.
 *
 * A streamed card carries the answer, so normally not. Two exceptions:
 *   - the card never delivered the answer (creation or write failed) → the user
 *     must get it somewhere, so send it;
 *   - the turn was STOPPED and its card exists → the card already says 已停止 and
 *     the answer is usually empty, so "（本轮无输出）" underneath it is pure noise
 *     (user feedback 2026-11-10).
 *
 * @param result - what the bridge reported for the turn
 * @returns true when the runtime should post `result.text`
 */
export declare function shouldSendTextFallback(result: {
    carded: boolean;
    cardCreated: boolean;
    reason: TurnEnd;
}): boolean;
/**
 * Whether a stop attempt must be refused because it is not the requester's turn.
 *
 * Both entry points (the card's ◯ 停止 and `/stop`) go through this, so the
 * button cannot be bypassed by typing the command. `undefined` = allowed.
 *
 * An UNKNOWN clicker is allowed on purpose: a payload-shape change must not
 * brick the button, and this is a courtesy guard, not an authorisation boundary
 * (the sender already passed the allowlist to start the turn).
 *
 * @param owner - who opened the running turn (undefined = nothing running)
 * @param clicker - who pressed stop (undefined = payload did not say)
 * @returns the refusal text, or undefined when the stop may proceed
 */
export declare function stopDenied(owner: string | undefined, clicker: string | undefined): string | undefined;
/**
 * @param ctx dsh context
 * @param read live config reader (volatile refs are re-read per message)
 * @param initial snapshot taken at startup, used for one-shot credentials
 * @param deps optional transport injection points (tests)
 */
export declare function createRuntime(ctx: Context, read: () => ResolvedConfig, initial: ResolvedConfig, deps?: RuntimeDeps): FeishuCardRuntime;
