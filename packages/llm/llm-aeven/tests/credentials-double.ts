/**
 * `ctx.credentials` stand-in for this route's resolution tests.
 *
 * `resolve` answers exactly the references it was seeded with, verbatim — an
 * empty seeded value resolves as an empty value rather than as `undefined`,
 * which is the case the route's own empty-value guard exists for — and reports
 * every other reference unresolved. The provider operations this route never
 * calls reject, so a test that comes to depend on one fails instead of
 * silently passing.
 */

import { CredentialProvider } from '@aeven/credentials'
import type {
  CredentialInfo,
  CredentialKey,
  CredentialRecord,
  CredentialRecordEntry,
  CredentialRecordInfo,
  CredentialRef,
  ResolvedCredential,
} from '@aeven/credentials'
import type { Context } from '@deepseek-ai/cordis'

/** In-memory credentials provider seeded with the values a test wants resolvable. */
export class StubCredentials extends CredentialProvider {
  private readonly values = new Map<string, string>()

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    for (const [ref, value] of Object.entries(seed)) this.values.set(ref, value)
  }

  /**
   * Resolve one seeded reference.
   * @param ref - the reference to resolve.
   * @returns the seeded value and its `stub` source, or `undefined` while unseeded.
   */
  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'stub' })
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.reject(this.unsupported('describe'))
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(this.unsupported('set'))
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(this.unsupported('unset'))
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.reject(this.unsupported('readRecord'))
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.reject(this.unsupported('describeRecord'))
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.reject(this.unsupported('listRecords'))
  }

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(this.unsupported('modifyRecord'))
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.reject(this.unsupported('deleteRecord'))
  }

  /** The refusal every credential operation outside {@link resolve} returns. */
  private unsupported(operation: string): Error {
    return new Error(`stub credentials: ${operation}() is not part of what the aeven-cloud route resolves`)
  }
}
