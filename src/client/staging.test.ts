import { describe, expect, it } from 'vitest'
import {
  addId,
  draftFrom,
  formatIds,
  idFormatOk,
  isDirty,
  malformedIds,
  overriddenFields,
  parseIds,
  removeId,
  resetOp,
  saveOps,
  secretConfigured,
  sameDraft,
  shortId,
  toggleFooterField,
  type Draft,
} from './staging.ts'
import { CONFIG_DEFAULTS, type FeishuCardConfig } from '../shared/types.ts'

const config = (over: Partial<FeishuCardConfig> = {}): FeishuCardConfig =>
  ({
    appId: 'cli_a',
    appSecret: 'secret',
    ...CONFIG_DEFAULTS,
    ...over,
  }) as FeishuCardConfig

const draft = (over: Partial<Draft> = {}): Draft => ({ ...draftFrom(config()), ...over })

describe('draftFrom', () => {
  it('starts with an empty secret box even when one is stored', () => {
    expect(draftFrom(config()).appSecret).toBe('')
  })
  it('copies the lists so edits never mutate the snapshot', () => {
    const value = config({ allowlist: ['ou_1'] })
    const d = draftFrom(value)
    d.allowlist.push('ou_2')
    expect(value.allowlist).toEqual(['ou_1'])
  })
})

describe('isDirty / sameDraft', () => {
  it('is clean right after a save', () => {
    const d = draft()
    expect(isDirty(d, d)).toBe(false)
  })
  it('notices a typed secret and nothing else', () => {
    expect(isDirty(draft({ appSecret: 'x' }), draft())).toBe(true)
  })
  it('notices reordered footer fields', () => {
    const a = draft({ footerFields: ['status', 'model'] })
    const b = draft({ footerFields: ['model', 'status'] })
    expect(isDirty(a, b)).toBe(true)
  })
  it('ignores an unchanged numeric field', () => {
    expect(sameDraft(draft({ flushIntervalMs: 800 }), draft({ flushIntervalMs: 800 }))).toBe(true)
  })
})

describe('saveOps', () => {
  it('writes only what changed', () => {
    const saved = draft()
    const ops = saveOps(draft({ model: 'auto/step-5-preview' }), saved)
    expect(ops).toEqual([{ op: 'set', path: ['model'], value: 'auto/step-5-preview' }])
  })

  it('writes an empty allowlist explicitly (fail-closed must persist)', () => {
    const saved = draft({ allowlist: ['ou_1'] })
    const ops = saveOps(draft({ allowlist: [] }), saved)
    expect(ops).toEqual([{ op: 'set', path: ['allowlist'], value: [] }])
  })

  it('never emits an op for an untouched secret', () => {
    expect(saveOps(draft(), draft())).toEqual([])
  })

  it('emits the secret when one was typed', () => {
    const ops = saveOps(draft({ appSecret: 'new' }), draft())
    expect(ops).toEqual([{ op: 'set', path: ['appSecret'], value: 'new' }])
  })

  it('is a no-op for a form nobody touched', () => {
    expect(saveOps(draft(), draft())).toEqual([])
  })
})

describe('overriddenFields', () => {
  it('reads the user layer, not a value comparison', () => {
    const snapshot = { user: { model: 'auto/step-5-preview', appId: 'cli_a' } }
    expect([...overriddenFields(snapshot)]).toEqual(['model', 'appId'])
  })
  it('is empty when the profile stores no override', () => {
    expect(overriddenFields({}).size).toBe(0)
    expect(overriddenFields({ user: {} }).size).toBe(0)
  })
})

describe('list helpers', () => {
  it('adds ids once', () => {
    expect(addId(['ou_1'], 'ou_2')).toEqual(['ou_1', 'ou_2'])
    expect(addId(['ou_1'], 'ou_1')).toEqual(['ou_1'])
    expect(addId(['ou_1'], '  ')).toEqual(['ou_1'])
  })
  it('removes ids', () => {
    expect(removeId(['ou_1', 'ou_2'], 'ou_1')).toEqual(['ou_2'])
  })
  it('toggles footer fields keeping order', () => {
    expect(toggleFooterField(['status', 'model'], 'tokens')).toEqual(['status', 'model', 'tokens'])
    expect(toggleFooterField(['status', 'model'], 'status')).toEqual(['model'])
  })
  it('shortens long ids only', () => {
    const long = 'ou_' + '0'.repeat(33)
    expect(shortId(long)).toBe('ou_000000000000000…0000')
    expect(shortId('oc_short')).toBe('oc_short')
  })
})

describe('parseIds', () => {
  const parse = (text: string) => parseIds(text, 'ou_')

  it('takes one id per line', () => {
    expect(parse('ou_a\nou_b')).toEqual(['ou_a', 'ou_b'])
  })

  it('takes comma, full-width comma, semicolon and space separated ids', () => {
    expect(parse('ou_a,ou_b')).toEqual(['ou_a', 'ou_b'])
    expect(parse('ou_a，ou_b')).toEqual(['ou_a', 'ou_b'])
    expect(parse('ou_a;ou_b')).toEqual(['ou_a', 'ou_b'])
    expect(parse('ou_a ou_b')).toEqual(['ou_a', 'ou_b'])
    expect(parse('ou_a, ou_b , ou_c')).toEqual(['ou_a', 'ou_b', 'ou_c'])
  })

  it('splits ids written with no separator at all', () => {
    expect(parse('ou_abc123ou_def456')).toEqual(['ou_abc123', 'ou_def456'])
    expect(parse('ou_abc123ou_def456ou_ghi789')).toEqual(['ou_abc123', 'ou_def456', 'ou_ghi789'])
  })

  it('splits concatenated oc_ ids for the group list', () => {
    expect(parseIds('oc_aoc_b', 'oc_')).toEqual(['oc_a', 'oc_b'])
  })

  it('splits a glued id of the other kind instead of merging it', () => {
    // Found live: `ou_aoc_b` used to come back as one nonsense id because only
    // the list's own prefix was treated as a boundary.
    expect(parse('ou_aoc_b')).toEqual(['ou_a', 'oc_b'])
    expect(parseIds('oc_aou_b', 'oc_')).toEqual(['oc_a', 'ou_b'])
  })

  it('strips decorations from a copied mention', () => {
    expect(parse('@张三 (ou_abc123)')).toEqual(['ou_abc123'])
    expect(parse('@张三 ou_abc123')).toEqual(['ou_abc123'])
    expect(parse('<ou_abc123>')).toEqual(['ou_abc123'])
    expect(parse('（ou_abc123）')).toEqual(['ou_abc123'])
  })

  it('keeps an id that merely carries an @ sign', () => {
    expect(parse('@ou_abc123')).toEqual(['ou_abc123'])
  })

  it('drops comments to the end of the line', () => {
    expect(parse('# 备注\n\nou_a\n  \nou_b')).toEqual(['ou_a', 'ou_b'])
    expect(parse('ou_a # 这是谁\nou_b')).toEqual(['ou_a', 'ou_b'])
  })

  it('de-duplicates', () => {
    expect(parse('ou_a\nou_a,ou_a')).toEqual(['ou_a'])
  })

  it('is empty for empty input', () => {
    expect(parse('')).toEqual([])
    expect(parse(undefined)).toEqual([])
    expect(parse('   \n  ')).toEqual([])
    expect(parse('# 只有注释')).toEqual([])
  })

  it('keeps a wrong-prefix id so the panel can warn about it', () => {
    expect(parse('ou_a,oc_b')).toEqual(['ou_a', 'oc_b'])
    expect(parse('张三')).toEqual(['张三'])
  })
})

describe('format check', () => {
  it('recognises the expected prefix', () => {
    expect(idFormatOk('ou_abc', 'ou_')).toBe(true)
    expect(idFormatOk('oc_abc', 'ou_')).toBe(false)
    expect(idFormatOk('abc', 'ou_')).toBe(false)
  })

  it('lists the malformed entries', () => {
    expect(malformedIds(['ou_a', 'oc_b', 'x'], 'ou_')).toEqual(['oc_b', 'x'])
    expect(malformedIds(['ou_a'], 'ou_')).toEqual([])
  })
})

describe('resetOp', () => {
  it('unsets the field so the deployment default applies again', () => {
    expect(resetOp('model')).toEqual({ op: 'unset', path: ['model'] })
  })
})

describe('secretConfigured', () => {
  const view = (secrets: { path: string[]; set: boolean }[]) => ({
    namespaces: [{ ns: 'feishu-card', secrets }],
  })

  it('is true when the host reports a stored secret', () => {
    expect(secretConfigured(view([{ path: ['appSecret'], set: true }]), 'feishu-card')).toBe(true)
  })

  it('is false when the position exists but holds nothing', () => {
    expect(secretConfigured(view([{ path: ['appSecret'], set: false }]), 'feishu-card')).toBe(false)
  })

  it('ignores other namespaces (a sibling plugin’s key is not ours)', () => {
    const mixed = {
      namespaces: [
        { ns: 'web-search-deepseek', secrets: [{ path: ['apiKey'], set: true }] },
        { ns: 'feishu-card', secrets: [{ path: ['appSecret'], set: false }] },
      ],
    }
    expect(secretConfigured(mixed, 'feishu-card')).toBe(false)
  })

  it('is false while the mirror is still loading', () => {
    expect(secretConfigured(undefined, 'feishu-card')).toBe(false)
    expect(secretConfigured({}, 'feishu-card')).toBe(false)
    expect(secretConfigured({ namespaces: [] }, 'feishu-card')).toBe(false)
  })
})
