/**
 * Feishu user authorisation via the Device Flow (RFC 8628).
 *
 * Why this and not the authorisation-code flow: the code flow needs a
 * **registered redirect_uri** in the developer console plus a local HTTP listener
 * to catch the callback. The device flow needs neither — the plugin asks Feishu
 * for a `user_code`, the person confirms it in a browser, and the plugin polls
 * for the token. Nothing to register, no fixed port to squat on.
 *
 * Verified live against a real tenant app on 2026-10-30:
 *   POST accounts.feishu.cn/oauth/v1/device_authorization
 *     → {device_code, user_code, verification_uri, expires_in: 600, interval: 5}
 *   POST open.feishu.cn/open-apis/authen/v2/oauth/token
 *     → 400 {"error":"authorization_pending","code":20094} until confirmed
 *
 * What it buys us: `search/v1/user` is **user-token only** (a bot app can never
 * call it), and the result's `open_id` is this app's namespace — exactly what the
 * allowlist stores. See references/panel-rules.md §12.
 */
import type { Brand } from '../shared/types.js'

/** Where the two endpoints live, per brand. */
export interface OAuthEndpoints {
  deviceAuthorization: string
  token: string
}

export function oauthEndpoints(brand: Brand): OAuthEndpoints {
  return brand === 'lark'
    ? {
        deviceAuthorization: 'https://accounts.larksuite.com/oauth/v1/device_authorization',
        token: 'https://open.larksuite.com/open-apis/authen/v2/oauth/token',
      }
    : {
        deviceAuthorization: 'https://accounts.feishu.cn/oauth/v1/device_authorization',
        token: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      }
}

/** What the person needs to see to approve the request. */
export interface DeviceAuthorization {
  deviceCode: string
  userCode: string
  /** Page to open; the `_complete` form pre-fills the code. */
  verificationUri: string
  verificationUriComplete: string
  /** Seconds until the code stops working. */
  expiresIn: number
  /** Minimum seconds between polls. */
  interval: number
}

/** The token pair a confirmed authorisation yields. */
export interface UserToken {
  accessToken: string
  refreshToken?: string
  /** Seconds until the access token expires. */
  expiresIn: number
  scope?: string
}

/** Feishu's "not confirmed yet" code, which is a state, not an error. */
const PENDING = 20094
const PENDING_ERROR = 'authorization_pending'
/** Too many polls in a row. */
const SLOW_DOWN = 'slow_down'

/** The subset of `fetch` this module needs, so tests can inject a fake. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>

export interface DeviceFlowOptions {
  appId: string
  appSecret: string
  brand: Brand
  /** Scopes to request, space-separated. Must already be granted to the app. */
  scope: string
  fetch?: FetchLike
  log?: (message: string) => void
}

/** Parse one endpoint answer, keeping Feishu's own error text. */
async function readJson(response: { status: number; text(): Promise<string> }): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`接口返回无法解析（HTTP ${response.status}）：${text.slice(0, 160)}`)
  }
}

/**
 * Start an authorisation: get the code the person types/confirms.
 *
 * The `verification_uri`s are returned by Feishu and must be used **verbatim**
 * (their own message says so — re-encoding one breaks it).
 */
export async function requestDeviceAuthorization(
  options: DeviceFlowOptions,
): Promise<DeviceAuthorization> {
  const doFetch = options.fetch ?? (fetch as unknown as FetchLike)
  const endpoints = oauthEndpoints(options.brand)
  const response = await doFetch(endpoints.deviceAuthorization, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: options.appId,
      client_secret: options.appSecret,
      scope: options.scope,
    }).toString(),
  })
  const body = await readJson(response)
  if (!body.device_code || !body.user_code) {
    throw new Error(
      `申请授权码失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`,
    )
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri ?? body.verification_url ?? '',
    verificationUriComplete: body.verification_uri_complete ?? body.verification_url ?? '',
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 600,
    interval: typeof body.interval === 'number' ? body.interval : 5,
  }
}

/**
 * Poll once. Returns the token when confirmed, `undefined` while the person
 * has not answered yet, and throws on a real failure.
 */
export async function pollDeviceToken(
  options: DeviceFlowOptions,
  deviceCode: string,
): Promise<UserToken | undefined> {
  const doFetch = options.fetch ?? (fetch as unknown as FetchLike)
  const endpoints = oauthEndpoints(options.brand)
  const response = await doFetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: options.appId,
      client_secret: options.appSecret,
      device_code: deviceCode,
    }).toString(),
  })
  const body = await readJson(response)
  if (body.error === PENDING_ERROR || body.code === PENDING) return undefined
  if (body.error === SLOW_DOWN) return undefined
  if (!body.access_token) {
    throw new Error(
      `换取用户凭证失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`,
    )
  }
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 7200,
    ...(body.scope ? { scope: String(body.scope) } : {}),
  }
}

/** Refresh an expired user token, keeping the (possibly rotated) refresh token. */
export async function refreshUserToken(
  options: DeviceFlowOptions,
  refreshToken: string,
): Promise<UserToken> {
  const doFetch = options.fetch ?? (fetch as unknown as FetchLike)
  const endpoints = oauthEndpoints(options.brand)
  const response = await doFetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: options.appId,
      client_secret: options.appSecret,
      refresh_token: refreshToken,
    }).toString(),
  })
  const body = await readJson(response)
  if (!body.access_token) {
    throw new Error(
      `刷新用户凭证失败：${body.error_description ?? body.msg ?? body.error ?? `HTTP ${response.status}`}`,
    )
  }
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 7200,
    ...(body.scope ? { scope: String(body.scope) } : {}),
  }
}

/** The scopes this feature needs. All three are already granted to the app. */
export const DIRECTORY_SCOPES = 'contact:user:search contact:user.base:readonly offline_access'
