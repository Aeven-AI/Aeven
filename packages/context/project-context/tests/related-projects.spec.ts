/** The related-project section: whose other folders appear, and how many. */
import { describe, expect, it } from 'vitest'
import type { Config } from '@aeven/project-context'
import type { Workspace } from '@aeven/workspace'
import {
  agentFor,
  mountProjectContext,
  orientationText,
  preStep,
  projectSession,
  workspace,
  type Mounted,
} from './harness.ts'

const CWD = '/home/ada/projects/site'

/** A mounted context in one project folder of the signed-in person. */
async function projectAt(workspaces?: readonly Workspace[], config: Partial<Config> = {}): Promise<Mounted> {
  const mounted = await mountProjectContext(workspaces === undefined ? { config } : { workspaces, config })
  mounted.fs!.seed(CWD, { type: 'directory' })
  mounted.fs!.list(CWD, [])
  return mounted
}

describe('project-context related project folders', () => {
  it('names the session owner\'s other project folders', async () => {
    const mounted = await projectAt([
      workspace({ id: 'site', kind: 'folder', path: CWD, title: 'Site', owner: 'ada' }),
      workspace({ id: 'server', kind: 'folder', path: '/home/ada/projects/server', title: 'Server', owner: 'ada' }),
      workspace({ id: 'components', kind: 'folder', path: '/home/ada/projects/components', title: 'Components', owner: 'ada' }),
      // Another account's folder, the current folder, a pathless record, and a
      // virtual workspace are all outside the orientation.
      workspace({ id: 'theirs', kind: 'folder', path: '/home/linus/projects/kernel', title: 'Kernel', owner: 'linus' }),
      workspace({ id: 'detached', kind: 'folder', title: 'Detached', owner: 'ada' }),
      workspace({ id: 'chats', kind: 'virtual', title: 'Chats', owner: 'ada' }),
    ])

    const text = orientationText(await preStep(mounted.ctx, agentFor(projectSession({ cwd: CWD, owner: 'ada' }))))

    expect(text).toContain([
      "The person's other project folders, which may hold other parts of the same product, such as its server, website or components; read them the same way when a question reaches into them:",
      '- Server: /home/ada/projects/server',
      '- Components: /home/ada/projects/components',
    ].join('\n'))
    expect(text).not.toContain('/home/linus/projects/kernel')
    expect(text).not.toContain('Detached')
    expect(text).not.toContain('Chats')
  })

  it('caps the named folders at maxRelatedProjects and counts the rest', async () => {
    const mounted = await projectAt([
      workspace({ id: 'one', kind: 'folder', path: '/home/ada/projects/one', title: 'one', owner: 'ada' }),
      workspace({ id: 'two', kind: 'folder', path: '/home/ada/projects/two', title: 'two', owner: 'ada' }),
      workspace({ id: 'three', kind: 'folder', path: '/home/ada/projects/three', title: 'three', owner: 'ada' }),
    ], { maxRelatedProjects: 1 })

    const text = orientationText(await preStep(mounted.ctx, agentFor(projectSession({ cwd: CWD, owner: 'ada' }))))

    expect(text).toContain('- one: /home/ada/projects/one\n- and 2 more')
    expect(text).not.toContain('/home/ada/projects/two')
  })

  it('omits the section when no workspace registry is mounted', async () => {
    const mounted = await projectAt()

    const text = orientationText(await preStep(mounted.ctx, agentFor(projectSession({ cwd: CWD, owner: 'ada' }))))

    expect(text).not.toContain('other project folders')
  })
})
