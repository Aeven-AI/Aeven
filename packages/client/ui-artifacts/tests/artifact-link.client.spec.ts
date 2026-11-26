/** An artifact's own address: its conversation with the file and stored copy after `#`, read back the same way. */
import { describe, expect, it } from 'vitest'
import type { Artifact, ArtifactId } from '@aeven/host-artifacts/types'
import { artifactHref, linkedArtifact } from '../src/client/links.ts'

const UUID = '45df5e4a-4133-4743-a3ec-dd98619df5a1'

function artifact(over: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a' as ArtifactId, sessionId: `session-${UUID}` as Artifact['sessionId'], path: '/Users/me/Aeven/vase & co/index.html',
    name: 'index.html', title: 'Vase', kind: 'page', createdAt: 1, ...over,
  }
}

describe('artifact links', () => {
  it('addresses the conversation and names the file and its copy after #', () => {
    const href = artifactHref(artifact({ attachmentId: 'att-1' }))
    const url = new URL(href, 'https://chat.example')
    expect(url.pathname).toBe(`/c/${UUID}`)
    expect(linkedArtifact(url.pathname, url.hash)).toEqual({
      sessionId: `session-${UUID}`, path: '/Users/me/Aeven/vase & co/index.html', attachmentId: 'att-1',
    })
  })

  it('spells a bare conversation id with the agent marker', () => {
    const url = new URL(artifactHref(artifact({ sessionId: UUID as Artifact['sessionId'] })), 'https://chat.example')
    expect(url.pathname).toBe(`/c/agent-${UUID}`)
    expect(linkedArtifact(url.pathname, url.hash)?.sessionId).toBe(UUID)
  })

  it('names no artifact without a file, or away from a conversation address', () => {
    expect(linkedArtifact(`/c/${UUID}`, '')).toBeUndefined()
    expect(linkedArtifact(`/c/${UUID}`, '#other=1')).toBeUndefined()
    expect(linkedArtifact('/artifacts', '#file=%2Fa.html')).toBeUndefined()
  })
})
