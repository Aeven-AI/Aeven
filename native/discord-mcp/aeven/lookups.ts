/**
 * Guild and channel lookups shared by the curated and administration tool surfaces.
 *
 * The guild is fixed by the environment, so a lookup result is valid for the
 * lifetime of the process and one fetch serves every tool call.
 */

import { isThread, type DiscordChannel, type DiscordGuild, type DiscordRole } from './refs.ts'
import { isGuildUnreachable, type DiscordRest } from './rest.ts'

/**
 * The error to report when Discord refuses a guild-scoped lookup.
 * @param guildId - the guild this process serves.
 * @param error - the value the request threw.
 * @returns a sentence naming the bot's absence when Discord answered 403 or 404, otherwise the original error.
 */
function guildOutOfReach(guildId: string, error: unknown): unknown {
  if (!isGuildUnreachable(error)) return error
  const status = error instanceof Error && 'status' in error ? String((error as { status: unknown }).status) : '?'
  return new Error(
    `Discord answered HTTP ${status} for guild ${guildId}: the Aeven bot is not in that server, or the server is gone.`,
  )
}

/** Where a channel sits in the guild's tree. */
export interface ChannelPlacement {
  /** Name of the category holding the channel, when it has one. */
  category: string | undefined
  /** Name of the channel holding a thread, when the channel is a thread. */
  parent: string | undefined
}

/** What both tool surfaces receive: the REST client, the fixed guild, and the shared cache. */
export interface DiscordContext {
  /** REST client authenticated as the deployment's Discord application. */
  rest: DiscordRest
  /** The one guild this process serves. */
  guildId: string
  /** Cached guild, channel, and role lookups. */
  lookups: GuildLookups
  /** Most messages a single `search_messages` call scans. */
  maxScanMessages: number
  /** Largest file `send_file` may upload. */
  maxFileBytes: number
}

/** Constructor values of {@link GuildLookups}. */
export interface GuildLookupOptions {
  /** REST client to look through. */
  rest: DiscordRest
  /** The one guild this process serves. */
  guildId: string
  /** Name the connector passed in the environment, used until a guild lookup succeeds. */
  nameHint?: string | undefined
}

/**
 * One guild's identity, channel list, and roles, each fetched once while its fetch succeeds.
 *
 * A failed fetch is dropped rather than remembered, so a transient failure does
 * not pin a wrong answer for the process's lifetime.
 */
export class GuildLookups {
  readonly #rest: DiscordRest
  readonly #guildId: string
  readonly #nameHint: string | undefined
  readonly #channels = new Map<string, DiscordChannel>()
  #guild: Promise<DiscordGuild> | undefined
  #channelList: Promise<DiscordChannel[]> | undefined
  #roleList: Promise<DiscordRole[]> | undefined

  /**
   * @param options - the REST client, the guild this process serves, and the connector's name for it.
   */
  constructor(options: GuildLookupOptions) {
    this.#rest = options.rest
    this.#guildId = options.guildId
    this.#nameHint = options.nameHint
  }

  /**
   * The guild as Discord reports it.
   * @returns the guild, including member and presence counts.
   * @throws {DiscordError} when Discord refuses the lookup.
   */
  async guild(): Promise<DiscordGuild> {
    this.#guild ??= this.#rest
      .request<DiscordGuild>('GET', `/guilds/${this.#guildId}?with_counts=true`)
      .catch((error: unknown) => {
        this.#guild = undefined
        throw guildOutOfReach(this.#guildId, error)
      })
    return await this.#guild
  }

  /**
   * The guild's display name.
   * @returns the connector's name when it supplied one, otherwise the name Discord reports.
   * @throws {DiscordError} when Discord refuses the lookup and no name was supplied.
   */
  async guildName(): Promise<string> {
    if (this.#nameHint !== undefined) return this.#nameHint
    const guild = await this.guild()
    return guild.name ?? this.#guildId
  }

  /**
   * Every channel the guild holds, threads excluded.
   * @returns the channels in Discord's order, including categories.
   * @throws {DiscordError} when Discord refuses the lookup.
   */
  async channels(): Promise<DiscordChannel[]> {
    this.#channelList ??= this.#rest
      .request<DiscordChannel[]>('GET', `/guilds/${this.#guildId}/channels`)
      .then((channels) => {
        for (const channel of channels) this.#channels.set(channel.id, channel)
        return channels
      })
      .catch((error: unknown) => {
        this.#channelList = undefined
        throw guildOutOfReach(this.#guildId, error)
      })
    return await this.#channelList
  }

  /**
   * A channel by id, serving it from the channel list once that list has been fetched.
   * @param channelId - the channel or thread to look up.
   * @returns the channel.
   * @throws {DiscordError} when Discord holds no such channel, or refuses the lookup.
   */
  async channel(channelId: string): Promise<DiscordChannel> {
    const known = this.#channels.get(channelId)
    if (known !== undefined) return known
    const channel = await this.#rest.request<DiscordChannel>('GET', `/channels/${channelId}`)
    this.#channels.set(channelId, channel)
    return channel
  }

  /**
   * The names that place a channel in the guild's tree.
   *
   * A channel's `parent_id` names its category; a thread's `parent_id` names the
   * channel that holds it, whose own `parent_id` names the category.
   * @param channel - the channel to place.
   * @returns the category's name and, for a thread, the parent channel's name.
   * @throws {DiscordError} when Discord refuses the channel-list lookup.
   */
  async place(channel: DiscordChannel): Promise<ChannelPlacement> {
    if (channel.parent_id === undefined || channel.parent_id === null) return { category: undefined, parent: undefined }
    const channels = await this.channels()
    const byId = (id: string): DiscordChannel | undefined => channels.find((candidate) => candidate.id === id)
    const first = byId(channel.parent_id)
    if (!isThread(channel.type)) return { category: first?.name, parent: undefined }
    const grandparent = first?.parent_id
    const category = grandparent === undefined || grandparent === null ? undefined : byId(grandparent)?.name
    return { category, parent: first?.name ?? channel.parent_id }
  }

  /**
   * Every role the guild holds.
   * @returns the roles.
   * @throws {DiscordError} when Discord refuses the lookup.
   */
  async roles(): Promise<DiscordRole[]> {
    this.#roleList ??= this.#rest
      .request<DiscordRole[]>('GET', `/guilds/${this.#guildId}/roles`)
      .catch((error: unknown) => {
        this.#roleList = undefined
        throw error
      })
    return await this.#roleList
  }

  /**
   * The names of the roles a member holds, in the guild's role order.
   * @param roleIds - the ids the member's record carries.
   * @returns the names of the roles that still exist.
   * @throws {DiscordError} when Discord refuses the role-list lookup.
   */
  async roleNames(roleIds: readonly string[]): Promise<string[]> {
    const roles = await this.roles()
    const wanted = new Set(roleIds)
    return roles.filter((role) => wanted.has(role.id)).map((role) => role.name ?? role.id)
  }
}
