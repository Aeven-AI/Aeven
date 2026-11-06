/**
 * Endpoint check for provider routes a person configures on a Host that serves many people. Such a Host makes the
 * request on the person's behalf, so an endpoint naming the Host's own network — loopback services, the cloud
 * metadata address, private ranges — would let anyone reach what only the Host can. Only `https` endpoints whose
 * host resolves to public addresses pass; the check runs again before every request, so a name that later resolves
 * elsewhere is refused then.
 * @module
 */
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { LlmError } from '@aeven/llm'

/**
 * Address ranges a person's endpoint may not resolve into, one list per family: a `BlockList` also matches IPv4
 * addresses against IPv6 rules, so a mapped-address rule in a shared list would refuse every IPv4 address.
 */
const NON_PUBLIC_V4 = new BlockList()
const NON_PUBLIC_V6 = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NON_PUBLIC_V4.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) NON_PUBLIC_V6.addSubnet(address, prefix, 'ipv6')

/**
 * Whether an address lies in a non-public range. IPv4-mapped IPv6 addresses are refused as a whole: a public
 * provider never resolves to one, and their spellings are many.
 * @param address - a resolved address.
 * @param version - its family.
 * @returns whether it is refused.
 */
function isNonPublic(address: string, version: number): boolean {
  return version === 6 ? NON_PUBLIC_V6.check(address, 'ipv6') : NON_PUBLIC_V4.check(address, 'ipv4')
}

/**
 * Refuse an endpoint that is not `https` or whose host resolves to a non-public address.
 * @param url - the endpoint a person configured.
 * @throws LlmError when the endpoint is refused.
 */
export async function assertPublicEndpoint(url: string): Promise<void> {
  if (!URL.canParse(url)) throw refused(url, 'it is not a URL')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw refused(url, 'only https endpoints are allowed')
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1')
  const family = isIP(host)
  const addresses = family === 0 ? await lookup(host, { all: true, order: 'verbatim' }) : [{ address: host, family }]
  if (addresses.length === 0) throw refused(url, 'its host does not resolve')
  for (const { address, family: version } of addresses) {
    if (isNonPublic(address, version)) throw refused(url, 'it resolves to a non-public address')
  }
}

function refused(url: string, reason: string): LlmError {
  return new LlmError(`llm-pi-ai: the provider endpoint ${JSON.stringify(url)} is refused: ${reason}`, 'INVALID_REQUEST')
}
