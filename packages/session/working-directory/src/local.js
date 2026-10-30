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
import { assertNever } from '@aeven/util-values';
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
export function localDirectory(input) {
    const { recorded, placement, replicated, entered } = input;
    if (recorded === undefined)
        return { state: 'absent' };
    switch (placement.state) {
        case 'unfiled':
            // No workspace accounts it here. A log this device wrote carries this
            // device's own directory; an imported one carries a foreign path with no
            // workspace identity to translate it through, so it stays unresolved.
            return replicated ? { state: 'unresolved', reason: 'workspace-not-here' } : localAt(recorded);
        case 'pending':
            return { state: 'unresolved', reason: 'workspace-not-here' };
        case 'filed': {
            const workspace = placement.workspace;
            if (workspace.kind !== 'folder' || workspace.path === undefined) {
                return { state: 'unresolved', reason: 'workspace-unbound' };
            }
            // A move made here outranks the log: it names a directory of this device.
            if (entered !== undefined)
                return { state: 'local', cwd: entered.cwd, root: workspace.path };
            if (replicated)
                return { state: 'local', cwd: workspace.path, root: workspace.path };
            // This device wrote the log, so its recorded pair is where the work is —
            // unless the workspace was relinked since, which moves that work to the
            // same place inside the new directory.
            return localAt(relocated(recorded, workspace.path, workspace.anchorPaths) ?? recorded);
        }
        default:
            return assertNever(placement, 'working directory session placement');
    }
}
function localAt(directory) {
    return { state: 'local', cwd: directory.cwd, root: directory.root };
}
/**
 * Move a recorded pair onto the directory a workspace now owns, when the
 * workspace was relinked after the session recorded it.
 * @param recorded - the pair the log recorded.
 * @param path - the workspace's current directory on this device.
 * @param anchors - directories the workspace owned earlier, most recent first.
 * @returns the pair translated onto `path`, or undefined when neither half is under an anchor.
 */
function relocated(recorded, path, anchors) {
    const cwd = under(anchors, recorded.cwd, path);
    const root = under(anchors, recorded.root, path);
    if (cwd === undefined && root === undefined)
        return undefined;
    return { cwd: cwd ?? recorded.cwd, root: root ?? recorded.root };
}
/**
 * Translate one directory that sat inside an anchor to the same place inside
 * the current directory.
 * @param anchors - directories the workspace owned earlier.
 * @param directory - the directory to translate.
 * @param path - the workspace's current directory.
 * @returns the translated directory, or undefined when it is under no anchor.
 */
function under(anchors, directory, path) {
    for (const anchor of anchors) {
        if (directory === anchor)
            return path;
        const separator = separatorOf(directory);
        if (!directory.startsWith(`${anchor}${separator}`))
            continue;
        const suffix = directory.slice(anchor.length + 1).split(separator).filter(part => part.length > 0);
        return [path, ...suffix].join(separator);
    }
    return undefined;
}
/**
 * The separator one absolute directory uses, so a Windows path on a Windows
 * device translates the same way a POSIX one does here.
 * @param directory - an absolute directory.
 * @returns its separator.
 */
function separatorOf(directory) {
    return directory.includes('\\') || /^[A-Za-z]:/.test(directory) ? '\\' : '/';
}
/** This device cannot act in the directory a session records, and why. */
export class WorkingDirectoryUnavailableError extends Error {
    sessionId;
    reason;
    /**
     * @param sessionId - the session whose directory is unavailable here.
     * @param reason - which local fact is missing.
     */
    constructor(sessionId, reason) {
        super(reason === 'workspace-unbound'
            ? `the workspace of session '${sessionId}' has no folder on this device yet; choose one before files are read or written`
            : `the workspace of session '${sessionId}' has not reached this device yet, so its folder is unknown here`);
        this.sessionId = sessionId;
        this.reason = reason;
        this.name = 'WorkingDirectoryUnavailableError';
    }
}
//# sourceMappingURL=local.js.map