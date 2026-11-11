/**
 * Outbound local files: a card can show text, but it cannot attach a file.
 *
 * The gap this closes: an agent that writes `build/report.csv` and links it as
 * `[报告](C:\out\report.csv)` gets the path rendered as dead text — the user
 * reads a filename and never receives the file. Images have had a rewrite path
 * since M3 (`card/images.ts`), because a card renders `img_key` but not a URL;
 * ordinary files need the other half: upload with `im/v1/files`, then send a
 * `file` message of their own.
 *
 * Everything here is pure. The caller decides what "exists" means (real fs in
 * production, a set in tests) and owns the upload, so this module stays a
 * parser and nothing else.
 */

/** One local file reference found in an answer. */
export interface LocalRef {
  /** Filesystem path, with any `file://` wrapper removed. */
  path: string
  /** What the markdown link called it; used as the attachment's name. */
  label: string
  /** Rendered as `![...]` — the caller may prefer to embed it as an image. */
  isImage: boolean
}

/** Matches `[label](target)` and `![alt](target)`; group 1 marks an image. */
const RE_LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g

/** Extensions we accept on a POSIX-looking absolute path (see `isLocalPath`). */
const EXT = /\.[A-Za-z0-9]{1,8}$/

/**
 * Is this markdown target a path on this machine rather than a URL?
 *
 * `https://…` and `img_key` are the pre-existing cases and stay untouched. On
 * POSIX a leading slash is ambiguous (`/api/foo` is a route, not a file), so an
 * extension is required there; a Windows drive letter or a UNC prefix is
 * unambiguous on its own.
 */
export function isLocalPath(target: string): boolean {
  if (!target) return false
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(target) && !target.startsWith('file://')) return false
  if (target.startsWith('file://')) return true
  if (/^[A-Za-z]:[\\/]/.test(target)) return true
  if (/^\\\\[^\\]/.test(target)) return true
  if (target.startsWith('/')) return EXT.test(target)
  return false
}

/** Turn a markdown target into a platform path (`file:///C:/x` → `C:/x`). */
export function toPath(target: string): string {
  if (!target.startsWith('file://')) return target
  const rest = target.slice('file://'.length)
  // `file:///C:/a/b` → `/C:/a/b`; `file://host/share` keeps the host.
  const withoutSlash = rest.startsWith('/') && /^\/[A-Za-z]:[\\/]/.test(rest) ? rest.slice(1) : rest
  try {
    return decodeURIComponent(withoutSlash)
  } catch {
    // A malformed escape must not throw on the seal path.
    return withoutSlash
  }
}

/** The last path segment, used when a link carries no label. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * Canonical form used to compare two references to the same file.
 *
 * The same file arrives spelled differently — `C:\out\a.csv` from one tool and
 * `file:///C:/out/a.csv` from another. Comparing raw strings made the dedupe
 * miss and, worse, made `stripFileLinks` fail to match the reference it had
 * just collected, so the dead path stayed in the card. Windows paths are also
 * case-insensitive; POSIX ones are not, so only a drive-qualified path folds.
 */
export function compareKey(path: string): string {
  const unified = path.replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(unified) ? unified.toLowerCase() : unified
}

export interface FindOptions {
  /** Only references that survive this check are returned. Default: accept all. */
  exists?: (path: string) => boolean
  /** Cap per answer (default `MAX_FILES_PER_ANSWER`). */
  max?: number
}

/** How many attachments one answer may send. */
export const MAX_FILES_PER_ANSWER = 5

/**
 * Collect the local files an answer links to.
 *
 * Ordered by first appearance and deduplicated by path: the same chart linked
 * twice is one upload. References whose file is missing are dropped silently —
 * an answer written on a different machine must not fail the turn.
 */
export function findLocalFiles(text: string, options: FindOptions = {}): LocalRef[] {
  const exists = options.exists ?? (() => true)
  const max = options.max ?? MAX_FILES_PER_ANSWER
  const seen = new Set<string>()
  const out: LocalRef[] = []
  for (const match of text.matchAll(RE_LINK)) {
    const target = match[3]!
    if (!isLocalPath(target)) continue
    const path = toPath(target)
    const key = compareKey(path)
    if (seen.has(key)) continue
    if (!exists(path)) continue
    seen.add(key)
    out.push({ path, label: (match[2] || '').trim() || baseName(path), isImage: match[1] === '!' })
    if (out.length >= max) break
  }
  return out
}

/**
 * Replace file links with a plain attachment hint.
 *
 * A card cannot render a file, so leaving `[报告](C:\out\report.csv)` in the
 * body shows the user a path they cannot click. The label is kept — the answer
 * still reads correctly — and the file itself arrives as a `file` message.
 * Image references are left alone: those are rewritten to an `img_key` by the
 * image resolver and must stay images.
 */
export function stripFileLinks(text: string, files: readonly LocalRef[]): string {
  const paths = new Set(files.filter((file) => !file.isImage).map((file) => compareKey(file.path)))
  if (paths.size === 0) return text
  return text.replace(RE_LINK, (whole, bang: string, label: string, target: string) => {
    if (bang === '!') return whole
    if (!paths.has(compareKey(toPath(target)))) return whole
    return `📎 ${label.trim() || baseName(toPath(target))}`
  })
}