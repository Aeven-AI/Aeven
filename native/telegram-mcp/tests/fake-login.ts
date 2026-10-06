/** A {@link TelegramLoginPort} that records what the flow asked for, so tests decide what Telegram answers. */

import type { LoginHandlers, TelegramIdentityRead, TelegramLoginFailure, TelegramLoginPort } from '../aeven/auth.ts'

export class FakeLogin implements TelegramLoginPort {
  handlers: LoginHandlers | undefined
  beginFailure: TelegramLoginFailure | undefined
  phones: string[] = []
  codes: string[] = []
  passwords: string[] = []
  verified: boolean[] = []
  loggedOut = false
  private read: TelegramIdentityRead = { kind: 'none' }

  /** Set what the next identity read finds. */
  answered(read: TelegramIdentityRead): void {
    this.read = read
  }

  async begin(phone: string, handlers: LoginHandlers): Promise<TelegramLoginFailure | undefined> {
    this.phones.push(phone)
    this.handlers = handlers
    return this.beginFailure
  }

  code(value: string): void {
    this.codes.push(value)
  }

  password(value: string): void {
    this.passwords.push(value)
  }

  async identity(verify: boolean): Promise<TelegramIdentityRead> {
    this.verified.push(verify)
    return this.read
  }

  async logOut(): Promise<void> {
    this.loggedOut = true
  }
}
