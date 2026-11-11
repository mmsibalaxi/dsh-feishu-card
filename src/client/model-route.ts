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
export function encodeModelRoute(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Decode a `<option value>`; undefined when it is not a route. */
export function decodeModelRoute(value: string): { provider: string; model: string } | undefined {
  const at = value.indexOf('\u0000')
  if (at <= 0 || at === value.length - 1) return undefined
  return { provider: value.slice(0, at), model: value.slice(at + 1) }
}

/** Which option the current config selects, or '' for "follow the host". */
export function modelRouteOf(provider: string | undefined, model: string | undefined): string {
  if (!provider || !model) return ''
  return encodeModelRoute(provider, model)
}

/** `magpie/auto/step-5-preview` for display. */
export function modelRouteLabel(provider: string, model: string): string {
  return `${provider}/${model}`
}
