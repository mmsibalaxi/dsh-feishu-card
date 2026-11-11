import type { CardTransport } from './streaming.ts';
export interface LarkCardTransportOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    /**
     * Called once the card's message exists, with its message id.
     *
     * The card id (CardKit) and the message id (im) are different identifiers and
     * only the latter arrives in `im.message.recalled_v1` — which is what the
     * message-protection guard needs to know which card just disappeared.
     */
    onCardMessage?: (info: {
        cardId: string;
        messageId: string;
    }) => void;
    logger?: {
        warn: (message: string) => void;
        info?: (message: string) => void;
    };
}
export declare class LarkCardTransport implements CardTransport {
    private readonly options;
    private readonly client;
    constructor(options: LarkCardTransportOptions);
    /** Create the card entity, post it into the chat, return its card id. */
    createCard(chatId: string, card: unknown, replyToMessageId?: string): Promise<string>;
    /**
     * Post a card into the chat, as a reply when a message id is given.
     *
     * Replying makes Feishu render the "回复 XXX" quote header, so an answer is
     * visibly attached to the message it answers.
     */
    private postCardMessage;
    updateCard(cardId: string, card: unknown, sequence: number): Promise<void>;
    batchUpdate(cardId: string, actions: unknown[], sequence: number): Promise<void>;
    settings(cardId: string, settings: unknown, sequence: number): Promise<void>;
    /**
     * Turn a non-zero Feishu code into a CardApiError carrying that code, so the
     * seal executor can branch on 300309/300301/300314/300315.
     */
    private call;
}
