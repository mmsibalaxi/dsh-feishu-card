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
}
/**
 * Download a URL with a hard timeout, for the outbound image pipeline.
 *
 * `fetch` has no timeout of its own; without the AbortController one slow image
 * host would hold the card open until the turn's own 10-minute cap.
 */
export declare function fetchBytes(url: string, timeoutMs?: number): Promise<Uint8Array>;
