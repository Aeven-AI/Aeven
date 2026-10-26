/**
 * Payloads for the prompt-cache warmer's log-only session events.
 * @module @aeven/llm-cache-warm/src/types
 */

import type { TokenUsage } from '@aeven/llm'

/** The route a warm request replays. */
export interface CacheWarmRoute {
  /** Provider the captured request named. */
  readonly provider: string
  /** Model the captured request named. */
  readonly model: string
}

/** One warm request, recorded before it is dispatched. */
export interface CacheWarmStartEventData {
  /** The tool call whose block this warm keeps covered. */
  readonly tool: string
  /** Consecutive warm within that tool block, from 1. */
  readonly ping: number
  /** Provider and model the warm replays. */
  readonly route: CacheWarmRoute
  /** Characters in the replayed prefix: system, tool schemas, and messages. */
  readonly prefixChars: number
}

/** The outcome of one warm request. */
export interface CacheWarmResultEventData {
  /** The tool call whose block the warm covered. */
  readonly tool: string
  /** Consecutive warm within that tool block, from 1. */
  readonly ping: number
  /** Provider and model the warm replayed. */
  readonly route: CacheWarmRoute
  /** Usage the provider reported for the warm; absent when it reported none. */
  readonly usage?: TokenUsage
  /** Why the warm produced no usable response. */
  readonly error?: string
}
