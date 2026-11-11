/**
 * Pull in the Cordis Context augmentations contributed by the official DSH
 * packages we consume. Module augmentation only lands when the declaring
 * module is part of the program, so we reference each one here instead of
 * importing them at runtime.
 *
 *   - @deepseek-ai/dsh-settings            → ctx.settings (host)
 *   - @deepseek-ai/dsh-client-ui-settings/client → ctx.configForms / ctx.settingsSchema
 *
 * `ctx.slots` is the one service whose runtime provider ships no Context
 * augmentation (dsh-client-ui-slults only publishes the slot *types*), so we
 * declare the minimal surface we use. Tighten it if upstream adds types.
 */
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Slot registry service; provided at runtime by the client slots host. */
    slots: {
      /** Returns the disposer that tears the registration down. */
      inject(name: string, factory: () => unknown): () => void
      register(
        def: {
          name: string
          /** Entry id for list slots (e.g. `plugins.item`). */
          id?: string
          key?: string
          order?: number
          label?: unknown
          locale?: string
          inject?: () => Record<string, unknown>
        },
        component: unknown,
      ): unknown
    }
  }
}
