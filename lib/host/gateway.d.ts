/**
 * Feishu/Lark gateway — WebSocket long connection.
 *
 * Uses the official `@larksuiteoapi/node-sdk`:
 *   const ws = new Lark.WSClient({ appId, appSecret, domain })
 *   await ws.start({ eventDispatcher })
 *
 * Long connection means no public callback URL, no reverse proxy — the same
 * transport the user's Hermes bridge and every other DSH bridge uses.
 *
 * Everything Feishu-specific is normalized into RawFeishuMessage here; the
 * access-control decision and agent driving live in access.ts / bridge.ts.
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import { type RawFeishuAttachment, type RawFeishuMessage } from './messages.ts';
export interface GatewayOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    onMessage: (raw: RawFeishuMessage) => void | Promise<void>;
    onUnsupported?: (info: {
        chatId: string;
        chatType: 'p2p' | 'group';
        type: string;
        senderOpenId?: string;
        mentioned?: boolean;
    }) => void;
    /**
     * Card button callbacks (`card.action.trigger`). Arrive over the same long
     * connection once the developer console subscribes to them; until then the
     * ask card's free-form path carries the answer instead.
     */
    onCardAction?: (data: unknown) => void | Promise<unknown>;
    /**
     * A message was recalled (撤回). Feishu sends this for the bot's own messages
     * too, which is how the streaming card learns it should stop updating.
     */
    onMessageRecalled?: (info: {
        messageId: string;
        chatId?: string;
    }) => void;
    /**
     * A picture / file / voice message. The bytes are NOT fetched here: the
     * runtime decides whether the sender is allowed before it spends a download.
     */
    onAttachment?: (attachment: RawFeishuAttachment) => void;
    logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        debug: (message: string) => void;
    };
}
/** Pull the file key / name out of a resource message's JSON content. */
export declare function parseResourceContent(type: string, content: string): {
    fileKey?: string;
    fileName?: string;
};
/**
 * Map a Feishu `im.message.receive_v1` payload onto our raw message.
 *
 * Pure and exported so the field mapping can be tested against realistic
 * payloads. NOTE the thread rule — learned from a production bug in the user's
 * own Hermes bridge (#19711 / #20548): `root_id` is present on EVERY quoted
 * reply, so using it as a thread fallback turns ordinary quote-replies into
 * topic sessions and pushes the answer into a fresh thread. Only a native
 * `thread_id` marks a topic.
 */
export declare function toRawMessage(data: {
    event_id?: string;
    sender: {
        sender_id?: {
            open_id?: string;
        };
        sender_type: string;
    };
    message: {
        message_id: string;
        chat_id: string;
        chat_type: string;
        message_type: string;
        content: string;
        thread_id?: string;
        root_id?: string;
        parent_id?: string;
        mentions?: {
            key: string;
            id?: {
                open_id?: string;
            };
            name: string;
        }[];
    };
}): RawFeishuMessage | undefined;
export declare class FeishuGateway {
    private readonly options;
    private ws?;
    constructor(options: GatewayOptions);
    get domain(): Lark.Domain;
    start(): Promise<void>;
    private handleEvent;
    stop(): Promise<void>;
}
