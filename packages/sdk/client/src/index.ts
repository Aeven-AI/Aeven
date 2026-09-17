/**
 * TypeScript client SDK for the Aeven runtime: spawn the
 * same-version `avn --profile sdk` runtime as a subprocess and drive agent
 * turns over stdio JSON-RPC. `Aeven` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; named profiles and ordered patch
 * files customize the runtime process it spawns.
 *
 * @module @aeven/sdk-client
 */

export { Aeven, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@aeven/sdk-protocol'
export type {
  ContentBlock,
  SdkPromptContentBlock,
  AevenOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
