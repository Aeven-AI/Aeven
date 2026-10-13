/**
 * Grok Imagine network allowlist / private-IP helpers.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */

import { BlockList, isIP } from 'node:net'
import { FROZEN_OUTPUT_HOSTS } from './types.ts'

const blockedNetworks = new BlockList()
blockedNetworks.addSubnet('0.0.0.0', 8, 'ipv4')
blockedNetworks.addSubnet('10.0.0.0', 8, 'ipv4')
blockedNetworks.addSubnet('100.64.0.0', 10, 'ipv4')
blockedNetworks.addSubnet('127.0.0.0', 8, 'ipv4')
blockedNetworks.addSubnet('169.254.0.0', 16, 'ipv4')
blockedNetworks.addSubnet('172.16.0.0', 12, 'ipv4')
blockedNetworks.addSubnet('192.0.0.0', 24, 'ipv4')
blockedNetworks.addSubnet('192.0.2.0', 24, 'ipv4')
blockedNetworks.addSubnet('192.88.99.0', 24, 'ipv4')
blockedNetworks.addSubnet('192.168.0.0', 16, 'ipv4')
blockedNetworks.addSubnet('198.18.0.0', 15, 'ipv4')
blockedNetworks.addSubnet('198.51.100.0', 24, 'ipv4')
blockedNetworks.addSubnet('203.0.113.0', 24, 'ipv4')
blockedNetworks.addSubnet('224.0.0.0', 4, 'ipv4')
blockedNetworks.addSubnet('240.0.0.0', 4, 'ipv4')
blockedNetworks.addSubnet('::', 128, 'ipv6')
blockedNetworks.addSubnet('::1', 128, 'ipv6')
blockedNetworks.addSubnet('::', 96, 'ipv6')
blockedNetworks.addSubnet('64:ff9b::', 96, 'ipv6')
blockedNetworks.addSubnet('64:ff9b:1::', 48, 'ipv6')
blockedNetworks.addSubnet('100::', 64, 'ipv6')
blockedNetworks.addSubnet('2001::', 32, 'ipv6')
blockedNetworks.addSubnet('2001:2::', 48, 'ipv6')
blockedNetworks.addSubnet('2001:db8::', 32, 'ipv6')
blockedNetworks.addSubnet('2002::', 16, 'ipv6')
blockedNetworks.addSubnet('3fff::', 20, 'ipv6')
blockedNetworks.addSubnet('5f00::', 16, 'ipv6')
blockedNetworks.addSubnet('fc00::', 7, 'ipv6')
blockedNetworks.addSubnet('fe80::', 10, 'ipv6')
blockedNetworks.addSubnet('ff00::', 8, 'ipv6')

function dottedFromWords(high: number, low: number): string {
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

function parseIPv6Groups(address: string): number[] | undefined {
  /* v8 ignore next -- split() always yields at least one element */
  const bare = address.toLowerCase().split('%', 1)[0] ?? ''
  let normalized = bare
  const v4tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(bare)
  if (v4tail) {
    /* v8 ignore next -- the capture group always participates when the regex matches */
    const ipv4 = v4tail[1] ?? ''
    /* v8 ignore next -- the IPv4-tail regex only matches dotted quads Node already classifies as IPv4 */
    if (isIP(ipv4) !== 4) return undefined
    const octets = ipv4.split('.').map(part => Number(part))
    /* v8 ignore next -- isIP(4) already validated four 0-255 octets */
    if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
      return undefined
    }
    /* v8 ignore start -- isIP(4) already validated four 0-255 octets, so every index is present */
    const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16)
    const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16)
    /* v8 ignore stop */
    normalized = `${bare.slice(0, v4tail.index + 1)}${high}:${low}`
  }
  const sides = normalized.split('::')
  /* v8 ignore next -- Node isIP rejects more than one '::' compression */
  if (sides.length > 2) return undefined
  const parseSide = (side: string | undefined): number[] | undefined => {
    if (side === undefined || side === '') return []
    const groups = side.split(':').map(group => Number.parseInt(group, 16))
    /* v8 ignore next -- Node isIP already rejected invalid hex groups */
    if (groups.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) return undefined
    return groups
  }
  if (sides.length === 1) {
    const groups = parseSide(sides[0])
    /* v8 ignore next -- Node isIP already rejected a non-compressed address that is not eight groups */
    return groups?.length === 8 ? groups : undefined
  }
  const head = parseSide(sides[0])
  const tail = parseSide(sides[1])
  /* v8 ignore next -- Node isIP already rejected over-long compressed forms */
  if (head === undefined || tail === undefined || head.length + tail.length > 8) return undefined
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail]
}

function embeddedIPv4s(address: string): string[] {
  const groups = parseIPv6Groups(address)
  /* v8 ignore next -- isBlockedIp only calls this after Node accepted the address as IPv6 */
  if (groups === undefined) return []
  const found = new Set<string>()
  /* v8 ignore next -- the parser returns undefined or exactly eight dense groups */
  const last32 = dottedFromWords(groups[6] ?? 0, groups[7] ?? 0)
  const headZero = groups.slice(0, 5).every(group => group === 0)
  /* v8 ignore next -- headZero with groups[5]===0 lies inside ::/96, which line 27 blocks before this helper is reached */
  if (headZero && (groups[5] === 0xffff || groups[5] === 0)) {
    found.add(last32)
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b) {
    found.add(last32)
  }
  return [...found]
}

function ipv4Mapped(address: string): string | undefined {
  const lower = address.toLowerCase()
  if (!lower.startsWith('::ffff:')) return undefined
  const rest = lower.slice('::ffff:'.length)
  if (isIP(rest) === 4) return rest
  const parts = rest.split(':')
  if (parts.length !== 2) return undefined
  /* v8 ignore start -- parts.length === 2 is enforced above, so both indices are present */
  const high = Number.parseInt(parts[0] ?? '', 16)
  const low = Number.parseInt(parts[1] ?? '', 16)
  /* v8 ignore stop */
  /* v8 ignore next -- Node isIP already rejected non-hex mapped tails */
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low < 0 || high > 0xffff || low > 0xffff) {
    return undefined
  }
  return dottedFromWords(high, low)
}

/**
 * True when an address is loopback, private, reserved, documentation, or an embedded special form.
 * @param address - Address value.
 * @returns Whether is blocked ip.
 */
export function isBlockedIp(address: string): boolean {
  if (isIP(address) === 0) return true
  if (isIP(address) === 4) return blockedNetworks.check(address, 'ipv4')
  if (blockedNetworks.check(address, 'ipv6')) return true
  /* v8 ignore next -- Node isIP=6 addresses always group in this parser */
  if (parseIPv6Groups(address) === undefined) return true
  const mapped = ipv4Mapped(address)
  /* v8 ignore next -- BlockList already matches IPv4-mapped forms that embed a blocked address */
  if (mapped !== undefined && isBlockedIp(mapped)) return true
  for (const embedded of embeddedIPv4s(address)) {
    if (isIP(embedded) === 4 && blockedNetworks.check(embedded, 'ipv4')) return true
  }
  return false
}

/**
 * Normalize hostname.
 * @param hostname - Hostname value.
 * @returns The resulting normalize hostname.
 */
export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/u, '')
}

/**
 * Return whether is blocked hostname.
 * @param hostname - Hostname value.
 * @returns Whether is blocked hostname.
 */
export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname)
  return (
    host === 'localhost' ||
		host === 'localhost.localdomain' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host.endsWith('.intranet')
  )
}

/**
 * Return whether is allowlisted imagine host.
 * @param hostname - Hostname value.
 * @returns Whether is allowlisted imagine host.
 */
export function isAllowlistedImagineHost(hostname: string): boolean {
  return FROZEN_OUTPUT_HOSTS.has(normalizeHostname(hostname))
}
