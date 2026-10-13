/**
 * The `/image-model` and `/video-model` pickers: popupSelect DECORATIONS hung on the host
 * command, so the surfaces that ask which image model to generate with show
 * one searchable list — the stored choice marked active, the same card the
 * `/model` line opens. The decoration owns the bare invocation only: the host
 * command keeps its catalog row, its argued path (`/image-model <model>`
 * still switches directly), and the write itself, which is why a pick
 * submits that line rather than editing the settings document from here.
 *
 * The rows are the deployment's configured choices, then every model a
 * `listedProviders` provider currently offers. That merge is derived here from
 * the same two sources the host reads — this client's settings scope and the
 * seam's own image-model catalog — because a subscription's image models
 * appear and disappear with its sign-in state, which no shipped list can
 * carry. The host re-resolves the offered choices when the line arrives and
 * refuses anything outside them, so this list guides and never authorizes.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionFace } from '@aeven/api-session-controller/client'
import type {} from '@aeven/api-session-controller/client'
// Type-only: pulls the ctx.remote merge and the served image-model catalog.
import type {} from '@aeven/api-remotes/client'
import type { ClientSessionContext } from '@aeven/client-ui-input-trigger/client'
import type { CommandDecoration, SelectOption } from '@aeven/client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// SlotRegistry service merge (ctx.slots).
import type {} from '@aeven/client-locale/client'
import type {} from '@aeven/client-ui-renderer/client'
// Type-only: pulls the `ctx.settingsScope` Context merge.
import type {} from '@aeven/client-ui-settings/client'

/**
 * Settings namespaces the media tool owns, one per kind. Each document holds
 * the selectable `choices` and the stored `provider`/`model` pair; the image
 * document also holds the `listedProviders`.
 */
const SETTINGS_NAMESPACE = { image: 'media', video: 'media-video' } as const

/** What one picker selects a model for. */
type MediaKind = keyof typeof SETTINGS_NAMESPACE

/** One selectable image model. */
interface OfferableModel {
  /** Media provider route id that serves this model. */
  provider: string
  /** The provider's model id, verbatim. */
  model: string
  /** Menu label; the `provider/model` pair when the source states none. */
  label?: string
  /** One-line note the source carries; searched, never rendered. */
  description?: string
}

/**
 * The media settings fields this picker reads, declared structurally: this
 * package renders a choice the tool owns and gains no dependency on it.
 */
interface MediaSettings {
  /** Stored provider of the current choice. */
  provider?: string
  /** Stored model id of the current choice. */
  model?: string
  /** The deployment's configured choices, in menu order. */
  choices?: readonly OfferableModel[]
  /** Media providers whose own listing is offered after `choices`. */
  listedProviders?: readonly string[]
}

/** Stable identity of one provider/model pair. */
function identityOf(model: OfferableModel): string {
  return `${model.provider}\u0000${model.model}`
}

/**
 * Every model the picker offers: the configured choices, then the models a
 * listed provider currently serves that the configured ones do not already
 * name.
 * @param settings - the resolved media settings document.
 * @param listed - every image model the composed providers publish.
 * @returns the models, in menu order.
 */
function offeredModels(
  settings: MediaSettings,
  listed: readonly { provider: string; id: string; label?: string; description?: string }[],
): OfferableModel[] {
  const configured = settings.choices ?? []
  const providers = new Set(settings.listedProviders ?? [])
  if (providers.size === 0) return [...configured]
  const known = new Set(configured.map(identityOf))
  const extra = listed
    .map(entry => ({
      provider: entry.provider,
      model: entry.id,
      ...entry.label === undefined ? {} : { label: entry.label },
      ...entry.description === undefined ? {} : { description: entry.description },
    }))
    .filter(model => providers.has(model.provider) && !known.has(identityOf(model)))
  return [...configured, ...extra]
}

/**
 * Render the offered models as popup rows.
 *
 * A row's id is its `provider/model` pair, which is the one form the host
 * command resolves verbatim. The detail line names the provider, as the model
 * picker's rows do; the source's description stays findable through
 * `keywords`, where a long note does not push the provider out of the row.
 * @param models - the offered models, in menu order.
 * @param current - the stored choice, marked active.
 * @returns the rows the shared popup shell renders and filters.
 */
function rowsOf(models: readonly OfferableModel[], current: MediaSettings): SelectOption[] {
  return models.map((model) => {
    const id = `${model.provider}/${model.model}`
    const keywords = [model.description, model.model].filter(entry => entry !== undefined).join(' ')
    return {
      id,
      label: model.label ?? id,
      detail: model.provider,
      ...keywords === '' ? {} : { keywords },
      ...current.provider === model.provider && current.model === model.model ? { active: true } : {},
    }
  })
}

/**
 * The `/image-model` decoration: a pick submits the host line that stores the
 * choice, so the write path and its confirmation stay the host command's.
 * @param ctx - client root context, carrying the settings scope, the session
 * faces, and the remote image-model catalog.
 * @returns the decoration the command surface hangs on the host command.
 */
export function imageModelDecoration(ctx: ClientContext): CommandDecoration {
  return modelDecoration(ctx, 'image')
}

/**
 * The `/video-model` decoration, offering the configured video models.
 * @param ctx - client root context, carrying the settings scope and the session faces.
 * @returns the decoration the command surface hangs on the host command.
 */
export function videoModelDecoration(ctx: ClientContext): CommandDecoration {
  return modelDecoration(ctx, 'video')
}

/**
 * One kind's model decoration. Only images read the seam's catalog, because
 * only the image document lists providers whose models come and go.
 * @param ctx - client root context.
 * @param kind - what the picked model generates.
 * @returns the decoration for `/<kind>-model`.
 */
function modelDecoration(ctx: ClientContext, kind: MediaKind): CommandDecoration {
  const command = `${kind}-model`
  const settings = ctx.settingsScope.bind<MediaSettings>({ namespace: SETTINGS_NAMESPACE[kind] })
  const sessions = ctx.sessions
  const sessionFor = (session: ClientSessionContext): SessionFace | undefined =>
    sessions.binding(session.sessionId)?.session
  return {
    name: command,
    // The decoration holds exactly while this client can read the deployment's
    // image-model settings; where it cannot — a host that exposes no such
    // document — the bare line falls through to the host command instead of
    // opening a list this client cannot fill.
    available: () => settings.getSnapshot().status !== 'unavailable',
    ui: {
      kind: 'popupSelect',
      options: async () => {
        // The shared mirror reads the Host document on first use; the first
        // open waits for that answer rather than reporting a host without one.
        await ctx.settingsScope.describe().ensure()
        const value = settings.getSnapshot().value
        if (value === undefined) throw new Error(`the ${kind}-model settings are not available on this host`)
        if (kind === 'video') return rowsOf(offeredModels(value, []), value)
        const response = await ctx.remote.session.imageModelCatalog()
        if (!response.ok) {
          throw new Error(`image model catalog failed: ${response.error.code}: ${response.error.message}`)
        }
        return rowsOf(offeredModels(value, response.value.models), value)
      },
      onSelect: async (option, session) => {
        const live = sessionFor(session)
        if (live === undefined) throw new Error('this session is not materialized yet')
        const result = await live.command(`/${command} ${option.id}`)
        if (!result.ok) throw new Error(`${kind} model switch failed: ${result.error.code}: ${result.error.message}`)
        if (!result.value.matched) throw new Error(`this host serves no /${command} command`)
      },
    },
  }
}
