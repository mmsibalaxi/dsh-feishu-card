/**
 * `provider\u0000model` ↔ { provider, model }.
 *
 * The settings config keeps provider and model as two fields, while the panel
 * offers one dropdown. The value an `<option>` carries has to survive a
 * round trip through the DOM, so it is encoded with a separator no model id or
 * provider route can contain (Feishu ids, npm-ish routes, and `auto/…` model
 * ids never hold NUL).
 */
/** Encode a route into a `<option value>`. */
export declare function encodeModelRoute(provider: string, model: string): string;
/** Decode a `<option value>`; undefined when it is not a route. */
export declare function decodeModelRoute(value: string): {
    provider: string;
    model: string;
} | undefined;
/** Which option the current config selects, or '' for "follow the host". */
export declare function modelRouteOf(provider: string | undefined, model: string | undefined): string;
/** `magpie/auto/step-5-preview` for display. */
export declare function modelRouteLabel(provider: string, model: string): string;
