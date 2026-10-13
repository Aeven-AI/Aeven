import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualAvnInstallLayout,
  buildDualAvnRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@aeven/cli': '0.2.0', 'avn-previous': 'npm:@aeven/cli@0.1.0' } },
      'node_modules/@deepseek-ai/cordis': { version: '4.0.1' },
      'node_modules/@aeven/cli': {
        version: '0.2.0',
        dependencies: { '@aeven/child': '^0.2.0' },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      },
      'node_modules/@aeven/child': {
        version: '0.2.0',
        dependencies: { '@aeven/leaf': '^0.2.0' },
      },
      'node_modules/@aeven/leaf': { version: '0.2.0' },
      'node_modules/avn-previous': {
        name: '@aeven/cli',
        version: '0.1.0',
        dependencies: { '@aeven/child': '^0.1.0' },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      },
      'node_modules/avn-previous/node_modules/@aeven/child': {
        version: '0.1.0',
        dependencies: { '@aeven/leaf': '^0.1.0' },
      },
      'node_modules/avn-previous/node_modules/@aeven/leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every AVN package', () => {
    const index: RegistryIndex = new Map([
      ['@aeven/cli', new Map([['0.1.1-rc.2', {
        name: '@aeven/cli',
        version: '0.1.1-rc.2',
        dependencies: { '@aeven/child': '^0.1.1-rc.2' },
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      }]])],
      ['@aeven/child', new Map([['0.1.1-rc.2', {
        name: '@aeven/child',
        version: '0.1.1-rc.2',
      }]])],
      ['@deepseek-ai/cordis', new Map([['4.0.1', {
        name: '@deepseek-ai/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualAvnRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@aeven/cli')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@aeven/cli')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@aeven/child': '^0.1.0' },
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
    })
    expect(dual.get('@aeven/cli')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@aeven/child': '^0.2.0' },
    })
    expect(dual.get('@deepseek-ai/cordis')).toBe(index.get('@deepseek-ai/cordis'))
  })

  it('accepts isolated AVN releases with one shared Cordis installation', () => {
    expect(assertDualAvnInstallLayout(validLayout())).toEqual({
      avnPackagesPerVersion: 3,
      checkedAvnEdges: 4,
    })
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/avn-previous/node_modules/@aeven/leaf')

    expect(() => assertDualAvnInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/avn-previous/node_modules/@aeven/child: dependencies '
      + '@aeven/leaf resolves to node_modules/@aeven/leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/avn-previous/node_modules/@deepseek-ai/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualAvnInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @deepseek-ai/cordis',
    )
  })
})
