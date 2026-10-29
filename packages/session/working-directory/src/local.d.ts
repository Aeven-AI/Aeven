/**
 * The directory this device acts in for a session, resolved from the shared
 * workspace identity rather than from the path the session's log recorded.
 *
 * `SessionHeader.cwd` and every `session/cwd` event name a directory on the
 * device that wrote them. A session of a synced account reaches other devices,
 * where that path may not exist and, worse, may name an unrelated directory of
 * the same spelling. The portable fact is the workspace the session belongs
 * to; the directory is this device's binding for that workspace. Resolution
 * therefore asks the registry where the session sits here and answers with a
 * local directory, an explicit refusal, or nothing to resolve — never another
 * machine's path.
 *
 * Pure: it reads no filesystem, so a directory the registry still binds but
 * that has since moved is answered by the workspace's own directory status, not
 * guessed here.
 *
 * @module @aeven/working-directory/local
 */
import type { SessionId } from '@aeven/session/types';
import type { SessionPlacement } from '@aeven/workspace/types';
/**
 * Why this device has no directory to act in for a session that records one.
 *
 * - `workspace-unbound` — the session's workspace reached this device without a
 *   directory of its own, so no folder here stands for it until one is chosen.
 * - `workspace-not-here` — the session was imported from another device and the
 *   workspace it belongs to has not arrived here yet.
 */
export type LocalDirectoryProblem = 'workspace-unbound' | 'workspace-not-here';
/**
 * Where one session's tool calls act on this device.
 *
 * - `local` — a directory and the workspace-write root to confine writes to.
 * - `unresolved` — the session records a directory, but no local one stands for
 *   it; acting would use another machine's path, so callers refuse instead.
 * - `absent` — the session records no directory at all (a workspace-less chat),
 *   which is a state to report, not a refusal.
 */
export type LocalDirectory = {
    readonly state: 'local';
    readonly cwd: string;
    readonly root: string;
} | {
    readonly state: 'unresolved';
    readonly reason: LocalDirectoryProblem;
} | {
    readonly state: 'absent';
};
/** A directory pair as the session log recorded it, on the device that wrote it. */
export interface RecordedDirectory {
    /** Directory in force after the folded log. */
    readonly cwd: string;
    /** Workspace root the recording device confined writes to. */
    readonly root: string;
}
/** Everything resolution reads, so the rule stays one testable function. */
export interface LocalDirectoryInput {
    /** The recorded pair, or undefined when the session records no directory. */
    readonly recorded: RecordedDirectory | undefined;
    /** Where the registry says this session sits on this device. */
    readonly placement: SessionPlacement;
    /** Whether the log came from another device. */
    readonly replicated: boolean;
    /** A directory this process itself moved the session into, which outranks the recorded one. */
    readonly entered: RecordedDirectory | undefined;
}
/**
 * Resolve one session's local directory.
 *
 * A session of this device keeps the directory its log records — that is where
 * the work actually is, including a worktree or a subdirectory the session moved
 * into. A session copied from another device acts in this device's binding for
 * its workspace, because its recorded path belongs to the machine that wrote it.
 * @param input - recorded directory, local placement, replication, and any directory this process entered.
 * @returns the local directory, an explicit problem, or `absent`.
 */
export declare function localDirectory(input: LocalDirectoryInput): LocalDirectory;
/** This device cannot act in the directory a session records, and why. */
export declare class WorkingDirectoryUnavailableError extends Error {
    readonly sessionId: SessionId;
    readonly reason: LocalDirectoryProblem;
    /**
     * @param sessionId - the session whose directory is unavailable here.
     * @param reason - which local fact is missing.
     */
    constructor(sessionId: SessionId, reason: LocalDirectoryProblem);
}
//# sourceMappingURL=local.d.ts.map