export interface SenderOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    logger?: {
        warn: (message: string) => void;
    };
}
export declare class FeishuSender {
    private readonly options;
    private readonly client;
    constructor(options: SenderOptions);
    /**
     * Send a plain text message into a chat. Long text is chunked by Feishu's limit.
     *
     * With `replyToMessageId` the message is posted as a reply, so Feishu renders
     * the "回复 XXX" quote header — which is how the user can tell which message
     * an answer belongs to.
     */
    sendText(chatId: string, text: string, replyToMessageId?: string): Promise<void>;
}
/** Feishu rejects very long text messages; split on line boundaries. */
export declare function chunkText(text: string, limit: number): string[];
