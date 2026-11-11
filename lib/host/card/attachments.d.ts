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
    path: string;
    /** What the markdown link called it; used as the attachment's name. */
    label: string;
    /** Rendered as `![...]` — the caller may prefer to embed it as an image. */
    isImage: boolean;
}
/**
 * Is this markdown target a path on this machine rather than a URL?
 *
 * `https://…` and `img_key` are the pre-existing cases and stay untouched. On
 * POSIX a leading slash is ambiguous (`/api/foo` is a route, not a file), so an
 * extension is required there; a Windows drive letter or a UNC prefix is
 * unambiguous on its own.
 */
export declare function isLocalPath(target: string): boolean;
/** Turn a markdown target into a platform path (`file:///C:/x` → `C:/x`). */
export declare function toPath(target: string): string;
/** The last path segment, used when a link carries no label. */
export declare function baseName(path: string): string;
/**
 * Canonical form used to compare two references to the same file.
 *
 * The same file arrives spelled differently — `C:\out\a.csv` from one tool and
 * `file:///C:/out/a.csv` from another. Comparing raw strings made the dedupe
 * miss and, worse, made `stripFileLinks` fail to match the reference it had
 * just collected, so the dead path stayed in the card. Windows paths are also
 * case-insensitive; POSIX ones are not, so only a drive-qualified path folds.
 */
export declare function compareKey(path: string): string;
export interface FindOptions {
    /** Only references that survive this check are returned. Default: accept all. */
    exists?: (path: string) => boolean;
    /** Cap per answer (default `MAX_FILES_PER_ANSWER`). */
    max?: number;
}
/** How many attachments one answer may send. */
export declare const MAX_FILES_PER_ANSWER = 5;
/**
 * Collect the local files an answer links to.
 *
 * Ordered by first appearance and deduplicated by path: the same chart linked
 * twice is one upload. References whose file is missing are dropped silently —
 * an answer written on a different machine must not fail the turn.
 */
export declare function findLocalFiles(text: string, options?: FindOptions): LocalRef[];
/**
 * Replace file links with a plain attachment hint.
 *
 * A card cannot render a file, so leaving `[报告](C:\out\report.csv)` in the
 * body shows the user a path they cannot click. The label is kept — the answer
 * still reads correctly — and the file itself arrives as a `file` message.
 * Image references are left alone: those are rewritten to an `img_key` by the
 * image resolver and must stay images.
 */
export declare function stripFileLinks(text: string, files: readonly LocalRef[]): string;
