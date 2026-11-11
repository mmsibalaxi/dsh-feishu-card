import { describe, expect, it } from 'vitest'
import {
  DIRECTORY_SCOPES,
  oauthEndpoints,
  pollDeviceToken,
  refreshUserToken,
  requestDeviceAuthorization,
  type FetchLike,
  type DeviceFlowOptions,
} from './device-flow.ts'

/** A fetch that answers from a queue, recording every request. */
function fakeFetch(answers: { status: number; body: unknown }[]) {
  const calls: { url: string; body: string }[] = []
  let index = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body })
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    return { status: answer.status, text: async () => JSON.stringify(answer.body) }
  }
  return { fetch, calls }
}

const options = (fetch: FetchLike): DeviceFlowOptions => ({
  appId: 'cli_a',
  appSecret: 's',
  brand: 'feishu',
  scope: DIRECTORY_SCOPES,
  fetch,
})

describe('oauthEndpoints', () => {
  it('points at the right hosts per brand', () => {
    expect(oauthEndpoints('feishu').deviceAuthorization).toBe(
      'https://accounts.feishu.cn/oauth/v1/device_authorization',
    )
    expect(oauthEndpoints('feishu').token).toBe(
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    )
    expect(oauthEndpoints('lark').deviceAuthorization).toContain('accounts.larksuite.com')
    expect(oauthEndpoints('lark').token).toContain('open.larksuite.com')
  })
})

describe('requestDeviceAuthorization', () => {
  it('returns the code and the exact verification URLs Feishu sent', async () => {
    // Shape taken from a live answer on 2026-10-30.
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: {
          device_code: 'dc-1',
          user_code: '4QBR-WG9M',
          verification_uri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
          verification_uri_complete:
            'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=4QBR-WG9M',
          expires_in: 600,
          interval: 5,
        },
      },
    ])
    const auth = await requestDeviceAuthorization(options(fetch))
    expect(auth).toEqual({
      deviceCode: 'dc-1',
      userCode: '4QBR-WG9M',
      verificationUri: 'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X',
      verificationUriComplete:
        'https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=X&user_code=4QBR-WG9M',
      expiresIn: 600,
      interval: 5,
    })
    expect(calls[0].url).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization')
    expect(calls[0].body).toContain('client_id=cli_a')
    expect(calls[0].body).toContain('scope=')
  })

  it('surfaces a refusal instead of inventing a code', async () => {
    const { fetch } = fakeFetch([
      { status: 400, body: { error: 'invalid_client', error_description: 'bad app secret' } },
    ])
    await expect(requestDeviceAuthorization(options(fetch))).rejects.toThrow('bad app secret')
  })

  it('rejects an unparseable answer', async () => {
    const bad: FetchLike = async () => ({ status: 500, text: async () => '<html>oops' })
    await expect(requestDeviceAuthorization(options(bad))).rejects.toThrow('无法解析')
  })
})

describe('pollDeviceToken', () => {
  it('returns undefined while the person has not confirmed', async () => {
    // The live pending answer.
    const { fetch } = fakeFetch([
      {
        status: 400,
        body: {
          error: 'authorization_pending',
          error_description: 'The authorization request is still pending.',
          code: 20094,
        },
      },
    ])
    expect(await pollDeviceToken(options(fetch), 'dc-1')).toBeUndefined()
  })

  it('treats slow_down as "keep waiting" rather than a failure', async () => {
    const { fetch } = fakeFetch([{ status: 400, body: { error: 'slow_down' } }])
    expect(await pollDeviceToken(options(fetch), 'dc-1')).toBeUndefined()
  })

  it('returns the token pair once confirmed', async () => {
    const { fetch, calls } = fakeFetch([
      {
        status: 200,
        body: { access_token: 'u-abc', refresh_token: 'ur-def', expires_in: 7200, scope: 'a b' },
      },
    ])
    expect(await pollDeviceToken(options(fetch), 'dc-1')).toEqual({
      accessToken: 'u-abc',
      refreshToken: 'ur-def',
      expiresIn: 7200,
      scope: 'a b',
    })
    expect(calls[0].body).toContain('grant_type=urn')
    expect(calls[0].body).toContain('device_code=dc-1')
  })

  it('throws on a real refusal', async () => {
    const { fetch } = fakeFetch([
      { status: 400, body: { error: 'expired_token', error_description: 'code expired' } },
    ])
    await expect(pollDeviceToken(options(fetch), 'dc-1')).rejects.toThrow('code expired')
  })
})

describe('refreshUserToken', () => {
  it('returns a rotated pair', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { access_token: 'u-new', refresh_token: 'ur-new', expires_in: 7200 } },
    ])
    expect(await refreshUserToken(options(fetch), 'ur-old')).toEqual({
      accessToken: 'u-new',
      refreshToken: 'ur-new',
      expiresIn: 7200,
    })
    expect(calls[0].body).toContain('grant_type=refresh_token')
    expect(calls[0].body).toContain('refresh_token=ur-old')
  })

  it('throws when the refresh token is dead', async () => {
    const { fetch } = fakeFetch([
      { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token expired' } },
    ])
    await expect(refreshUserToken(options(fetch), 'ur-old')).rejects.toThrow('refresh token expired')
  })
})
