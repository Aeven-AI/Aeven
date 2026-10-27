/**
 * One device at a time holds exclusive work of an account: the holder renews it, another device waits for it
 * to be released or to expire, a device sync does not serve always may work, and a lost connection stops the
 * work once the local expiry passes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaseHolder } from '../src/index.ts'
import { MemorySyncNetwork } from './memory.ts'

const holders: LeaseHolder[] = []
afterEach(async () => { await Promise.all(holders.splice(0).map(holder => holder.dispose())) })

function holder(network: MemorySyncNetwork, device = network.device(), name = 'memory/maintenance'): LeaseHolder {
  const created = new LeaseHolder(device.asSync(), 'owner', name, { ttlMs: 1_000, renewMs: 60_000 }, { now: () => network.now() })
  holders.push(created)
  return created
}

describe('LeaseHolder', () => {
  it('lets one device work, then the other once the first releases or its lease expires', async () => {
    const network = new MemorySyncNetwork()
    let clock = 0
    network.now = () => clock
    const first = holder(network)
    const second = holder(network)
    expect(first.held()).toBe(false)
    await first.renew()
    await second.renew()
    expect([first.held(), second.held()]).toEqual([true, false])
    clock = 2_000
    expect(first.held()).toBe(false)
    await second.renew()
    expect(second.held()).toBe(true)
    await second.dispose()
    expect(second.held()).toBe(false)
    await first.renew()
    expect(first.held()).toBe(true)
  })

  it('renews on its own while started', async () => {
    const network = new MemorySyncNetwork()
    const lease = new LeaseHolder(network.device().asSync(), 'owner', 'memory/maintenance', { ttlMs: 1_000, renewMs: 5 })
    holders.push(lease)
    lease.start()
    const first = network.leases.get('memory/maintenance')!.expiresAt
    await vi.waitFor(() => { expect(network.leases.get('memory/maintenance')!.expiresAt).toBeGreaterThan(first) })
  })

  it('reports when a renewal wins or loses the lease', async () => {
    const network = new MemorySyncNetwork()
    let clock = 0
    network.now = () => clock
    const changes: boolean[] = []
    const lease = new LeaseHolder(network.device().asSync(), 'owner', 'automations/scheduler', { ttlMs: 1_000, renewMs: 60_000 }, {
      now: () => network.now(),
      changed: (held) => { changes.push(held) },
    })
    holders.push(lease)
    const other = holder(network, network.device(), 'automations/scheduler')
    await other.renew()
    await lease.renew()
    clock = 500
    await other.renew()
    clock = 2_000
    await lease.renew()
    await lease.renew()
    expect(changes).toEqual([true])
    await other.renew()
    clock = 3_100
    await other.renew()
    await lease.renew()
    expect(changes).toEqual([true, false])
  })

  it('lets a device work while sync does not serve its account', async () => {
    const network = new MemorySyncNetwork()
    expect(holder(network, network.device('unenrolled')).held()).toBe(true)
    expect(holder(network, network.device('joining')).held()).toBe(true)
  })

  it('keeps the last expiry when the relay is unreachable, and starts renewing once', async () => {
    const network = new MemorySyncNetwork()
    let clock = 0
    network.now = () => clock
    const device = network.device()
    const lease = holder(network, device)
    lease.start()
    lease.start()
    await lease.renew()
    expect(lease.held()).toBe(true)
    device.setState('offline')
    await lease.renew()
    expect(lease.held()).toBe(true)
    clock = 1_500
    expect(lease.held()).toBe(false)
    clock = 1_600
    device.setState('online')
    await lease.renew()
    device.setState('offline')
    await lease.dispose()
    await lease.dispose()
  })
})
