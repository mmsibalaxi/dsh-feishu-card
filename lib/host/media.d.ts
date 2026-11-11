/** Resource kinds Feishu's message-resource API accepts. */
export type ResourceKind = 'image' | 'file' | 'audio' | 'media';
export interface FeishuMediaOptions {
    appId: string;
    appSecret: string;
    brand: 'feishu' | 'lark';
    /** Directory downloaded attachments land in (created on demand). */
    dir: string;
    logger?: {
        warn: (message: string) => void;
        debug?: (message: string) => void;
    };
}
export declare class FeishuMedia {
    private readonly options;
    private readonly client;
    constructor(options: FeishuMediaOptions);
    /**
     * Download one message resource and return the local path.
     *
     * The file name is derived from the message id (unique per message) plus a
     * sanitized suffix, so two identical screenshots never overwrite each other
     * and a hostile `file_name` cannot escape the directory.
     */
    saveResource(input: {
        messageId: string;
        fileKey: string;
        kind: ResourceKind;
        fileName?: string;
    }): Promise<string>;
    /**
     * Upload an image for use inside a card and return its `img_key`.
     *
     * `image_type: 'message'` is the bucket card images and chat images read
     * from; the `'avatar'` bucket would upload fine and never render.
     */
    uploadImage(bytes: Uint8Array, name: string): Promise<string>;
    /**
     * Upload an arbitrary file so it can be sent as a `file` message.
     *
     * `file_type: 'stream'` is the bucket for "anything else" — the typed buckets
     * (`opus`, `mp4`, `pdf`, `doc`, `xls`, `ppt`) only change which renderer Feishu
     * picks, and guessing wrong makes Feishu reject the send. The name is stored
     * server-side at upload time, which is why the message body carries only the
     * key.
     */
    uploadFile(bytes: Uint8Array, fileName: string): Promise<string>;
}
/**
 * Download a URL with a hard timeout, for the outbound image pipeline.
 *
 * `fetch` has no timeout of its own; without the AbortController one slow image
 * host would hold the card open until the turn's own 10-minute cap.
 */
export declare function fetchBytes(url: string, timeoutMs?: number): Promise<Uint8Array>;
