/**
 * Host-native command execution and path-opening utilities.
 * @module @aeven/native-command
 */

export { runNativeCommand } from './runner.ts'
export type { NativeCommandRunner } from './runner.ts'
export {
  canOpenNativePath,
  openNativePath,
  openNativeTextFile,
} from './path-opener.ts'
export type {
  PathOpenerInternals,
  PathOpenerRunner,
} from './path-opener.ts'
