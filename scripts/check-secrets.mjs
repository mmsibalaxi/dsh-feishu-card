/**
 * Refuse to ship real credentials.
 *
 * Runs on `prepublishOnly` and is meant to be run by hand before the first
 * public push too. Two classes of leak are checked:
 *
 *   1. A literal App Secret / token (a long random-looking assignment).
 *   2. Real Feishu identifiers — app ids, open ids, chat ids — which are not
 *      credentials but do identify a real tenant, its people and its groups.
 *      Placeholders (`cli_xxxx…`, `ou_0000…`) are explicitly allowed.
 *
 * Exit code 1 with a file:line list; nothing is auto-fixed, because silently
 * rewriting a file is how a "fix" becomes a commit nobody reviewed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'lib', 'coverage', '.state'])
const SKIP_FILES = new Set(['PROGRESS.md', 'package-lock.json'])

const RULES = [
  {
    name: 'app secret / token literal',
    // e.g. appSecret: 'i8G7…' — 24+ chars mixing case and digits.
    pattern: /(?:app_?secret|appSecret|tenant_access_token|authorization)\s*[:=]\s*['"](?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}['"]/i,
    hint: '把密钥移到环境变量（FEISHU_APP_SECRET），并在开发者后台重置它',
  },
  {
    name: 'real app id',
    pattern: /\bcli_(?!x{16}|y{16}|0{16})[a-z0-9]{16}\b/,
    hint: '换成 cli_xxxxxxxxxxxxxxxx 占位符',
  },
  {
    name: 'real open_id',
    pattern: /\bou_(?!0{8})[a-f0-9]{32}\b/,
    hint: '换成 ou_0000000000000000000000000000000a 占位符',
  },
  {
    name: 'real chat_id',
    pattern: /\boc_(?!0{8})[a-f0-9]{32}\b/,
    hint: '换成 oc_0000000000000000000000000000000a 占位符',
  },
  {
    name: 'personal home path',
    pattern: /C:\\Users\\(?!<)[A-Za-z]/,
    hint: '换成 ~ 或相对路径',
  },
]

const TEXT_EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.txt'])

/** @returns {string[]} offending `file:line` entries */
export function scan(root = ROOT) {
  const findings = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (SKIP_FILES.has(entry.name)) continue
      if (!TEXT_EXT.has(path.extname(entry.name))) continue
      const file = path.join(dir, entry.name)
      if (statSync(file).size > 512 * 1024) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (!rule.pattern.test(line)) continue
          findings.push({
            where: `${path.relative(root, file)}:${index + 1}`,
            rule: rule.name,
            hint: rule.hint,
            sample: line.trim().slice(0, 120),
          })
        }
      })
    }
  }
  walk(root)
  return findings
}

const findings = scan()
if (findings.length === 0) {
  console.log('check-secrets: clean — no credentials or real identifiers found')
  process.exit(0)
}
console.error(`check-secrets: ${findings.length} problem(s) found\n`)
for (const finding of findings) {
  console.error(`  ${finding.where}  [${finding.rule}]`)
  console.error(`    ${finding.sample}`)
  console.error(`    → ${finding.hint}\n`)
}
process.exit(1)
