/**
 * Media both ways: Feishu attachments coming in, markdown images going out.
 *
 * Inbound — a Feishu user sends a screenshot far more often than they type a
 * paragraph, and the old gateway answered those with "暂时只支持文字消息". The
 * file is downloaded to a local directory and handed to the agent as a path it
 * can actually read, which is the same trade hermes makes with its media cache
 * (it just also re-uploads thumbnails for the reply).
 *
 * Outbound — an answer that mentions `![chart](https://…)` used to arrive with
 * the image silently deleted (`card/md.ts` drops unresolved image refs, because
 * a bare external URL does not render in a Feishu card). Uploading the bytes and
 * swapping in an `img_key` is what makes the image show up.
 */
import * as Lark from '@larksuiteoapi/node-sdk'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Resource kinds Feishu's message-resource API accepts. */
export type ResourceKind = 'image' | 'file' | 'audio' | 'media'

export interface FeishuMediaOptions {
  appId: string
  appSecret: string
  brand: 'feishu' | 'lark'
  /** Directory downloaded attachments land in (created on demand). */
  dir: string
  logger?: { warn: (message: string) => void; debug?: (message: string) => void }
}

/** Feishu refuses resources above 100 MB; refuse them before downloading. */
const MAX_BYTES = 30 * 1024 * 1024

export class FeishuMedia {
  private readonly client: Lark.Client

  constructor(private readonly options: FeishuMediaOptions) {
    this.client = new Lark.Client({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.brand === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu,
    })
  }

  /**
   * Download one message resource and return the local path.
   *
   * The file name is derived from the message id (unique per message) plus a
   * sanitized suffix, so two identical screenshots never overwrite each other
   * and a hostile `file_name` cannot escape the directory.
   */
  async saveResource(input: {
    messageId: string
    fileKey: string
    kind: ResourceKind
    fileName?: string
  }): Promise<string> {
    const dir = this.options.dir
    await mkdir(dir, { recursive: true })
    const suffix = safeSuffix(input.fileName, input.kind)
    const target = path.join(dir, `${sanitize(input.messageId)}${suffix}`)
    const response = await this.client.im.v1.messageResource.get({
      path: { message_id: input.messageId, file_key: input.fileKey },
      params: { type: input.kind },
    })
    await response.writeFile(target)
    this.options.logger?.debug?.(`feishu-card: saved ${input.kind} → ${target}`)
    return target
  }

  /**
   * Upload an image for use inside a card and return its `img_key`.
   *
   * `image_type: 'message'` is the bucket card images and chat images read
   * from; the `'avatar'` bucket would upload fine and never render.
   */
  async uploadImage(bytes: Uint8Array, name: string): Promise<string> {
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error(`image too large (${Math.round(bytes.byteLength / 1024)} KB)`)
    }
    const response = await this.client.im.v1.image.create({
      data: { image_type: 'message', image: Buffer.from(bytes) },
    })
    const key = response?.image_key
    if (!key) throw new Error(`image upload returned no image_key for ${name}`)
    return key
  }
}

/** Strip path separators and anything a shell would enjoy. */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'file'
}

const EXT_BY_KIND: Record<ResourceKind, string> = {
  image: '.png',
  file: '.bin',
  audio: '.opus',
  media: '.mp4',
}

function safeSuffix(fileName: string | undefined, kind: ResourceKind): string {
  if (fileName) {
    const ext = path.extname(fileName)
    if (ext && ext.length <= 12) return sanitize(ext)
  }
  return EXT_BY_KIND[kind]
}

/**
 * Download a URL with a hard timeout, for the outbound image pipeline.
 *
 * `fetch` has no timeout of its own; without the AbortController one slow image
 * host would hold the card open until the turn's own 10-minute cap.
 */
export async function fetchBytes(url: string, timeoutMs = 5000): Promise<Uint8Array> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) throw new Error('image too large')
    return new Uint8Array(buffer)
  } finally {
    clearTimeout(timer)
  }
}
