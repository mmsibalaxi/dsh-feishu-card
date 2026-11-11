/** How many images one answer may upload. */
export declare const MAX_IMAGES_PER_ANSWER = 3;
export interface ImageResolverOptions {
    upload(bytes: Uint8Array, name: string): Promise<string>;
    fetchBytes?: (url: string, timeoutMs?: number) => Promise<Uint8Array>;
    max?: number;
    log?: (message: string) => void;
}
/**
 * Build the resolver the streaming card calls before sealing.
 *
 * @returns a function that rewrites image references in place (best effort).
 */
export declare function createImageResolver(options: ImageResolverOptions): (text: string) => Promise<string>;
