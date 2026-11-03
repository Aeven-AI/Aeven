/**
 * Switch for the multi-megabyte, multi-million-member boundary proofs.
 *
 * Those cases exist to show a traversal holds one cursor per nesting level and a
 * byte budget rejects before its secondary allocations at a scale that would OOM
 * the host. Every branch they reach is also reached by the mutation-sized cases
 * beside them, so the default unit run leaves the scale runs out and the property
 * they add — width and depth far beyond a frame — is paid for only on request.
 */

/** Set to `1` to include the boundary proofs in a run (`pnpm run test:boundary`). */
export const BOUNDARY_PROOF_ENV = 'AVN_BOUNDARY_PROOFS'

/** Whether the current run includes the multi-megabyte boundary proofs. */
export const boundaryProofs = process.env[BOUNDARY_PROOF_ENV] === '1'
