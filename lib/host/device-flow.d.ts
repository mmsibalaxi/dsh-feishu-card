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
import type { Brand } from '../shared/types.js';
/** Where the two endpoints live, per brand. */
export interface OAuthEndpoints {
    deviceAuthorization: string;
    token: string;
}
export declare function oauthEndpoints(brand: Brand): OAuthEndpoints;
/** What the person needs to see to approve the request. */
export interface DeviceAuthorization {
    deviceCode: string;
    userCode: string;
    /** Page to open; the `_complete` form pre-fills the code. */
    verificationUri: string;
    verificationUriComplete: string;
    /** Seconds until the code stops working. */
    expiresIn: number;
    /** Minimum seconds between polls. */
    interval: number;
}
/** The token pair a confirmed authorisation yields. */
export interface UserToken {
    accessToken: string;
    refreshToken?: string;
    /** Seconds until the access token expires. */
    expiresIn: number;
    scope?: string;
}
/** The subset of `fetch` this module needs, so tests can inject a fake. */
export type FetchLike = (url: string, init: {
    method: string;
    headers: Record<string, string>;
    body: string;
}) => Promise<{
    status: number;
    text(): Promise<string>;
}>;
export interface DeviceFlowOptions {
    appId: string;
    appSecret: string;
    brand: Brand;
    /** Scopes to request, space-separated. Must already be granted to the app. */
    scope: string;
    fetch?: FetchLike;
    log?: (message: string) => void;
}
/**
 * Start an authorisation: get the code the person types/confirms.
 *
 * The `verification_uri`s are returned by Feishu and must be used **verbatim**
 * (their own message says so — re-encoding one breaks it).
 */
export declare function requestDeviceAuthorization(options: DeviceFlowOptions): Promise<DeviceAuthorization>;
/**
 * Poll once. Returns the token when confirmed, `undefined` while the person
 * has not answered yet, and throws on a real failure.
 */
export declare function pollDeviceToken(options: DeviceFlowOptions, deviceCode: string): Promise<UserToken | undefined>;
/** Refresh an expired user token, keeping the (possibly rotated) refresh token. */
export declare function refreshUserToken(options: DeviceFlowOptions, refreshToken: string): Promise<UserToken>;
/** The scopes this feature needs. All three are already granted to the app. */
export declare const DIRECTORY_SCOPES = "contact:user:search contact:user.base:readonly offline_access";
