/** Successful-result caching must track discovered targets and verifier implementation. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('invalidates cached success when an input, linked target, directory, or verifier changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-fingerprint-'))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'target-directory'))
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
    copyFileSync(new URL('./gate-fingerprint.ts', import.meta.url), join(root, 'scripts/gate-fingerprint.ts'))
    writeFileSync(join(root, 'README.md'), '[target](target.ts)\n')
    writeFileSync(join(root, 'target.ts'), 'export {}\n')
    writeFileSync(join(root, 'scripts/verifier.ts'), '// verifier\n')
    writeFileSync(join(root, 'check.mts'), `
      import { recordGreen, skipIfUnchanged } from './scripts/gate-fingerprint.ts';
      import { readFileSync, rmSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      const root = import.meta.dirname;
      const input = ['README.md', 'scripts/verifier.ts'];
      const dependencies = ['target.ts', 'target-directory'];
      const states = { missing: skipIfUnchanged('links', input) };
      recordGreen('links', input, dependencies);
      states.unchanged = skipIfUnchanged('links', input);
      rmSync(join(root, 'target.ts'));
      states.deletedTarget = skipIfUnchanged('links', input);
      writeFileSync(join(root, 'target.ts'), 'export {}\\n');
      rmSync(join(root, 'target-directory'), { recursive: true });
      states.deletedDirectory = skipIfUnchanged('links', input);
      recordGreen('links', input, ['target.ts']);
      writeFileSync(join(root, 'scripts/verifier.ts'), '// changed verifier\\n');
      states.changedVerifier = skipIfUnchanged('links', input);
      recordGreen('links', input, ['target.ts']);
      writeFileSync(join(root, 'README.md'), 'changed\\n');
      states.changedDocument = skipIfUnchanged('links', input);
      recordGreen('links', input, ['target.ts']);
      const helper = join(root, 'scripts/gate-fingerprint.ts');
      writeFileSync(helper, readFileSync(helper, 'utf8') + '\\n// changed cache code\\n');
      states.changedCacheCode = skipIfUnchanged('links', input);
      writeFileSync(join(root, 'node_modules/.cache/avn-gate-fingerprints/links.json'), '{"fingerprint":"legacy"}');
      states.legacy = skipIfUnchanged('links', input);
      console.log(JSON.stringify(states));
    `)
    const result = spawnSync(process.execPath, [
      '--import', createRequire(import.meta.url).resolve('tsx/esm'), join(root, 'check.mts'),
    ], { encoding: 'utf8', env: { ...process.env, AVN_GATE_CACHE: '1' }, timeout: 20_000 })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toEqual({
      missing: false,
      unchanged: true,
      deletedTarget: false,
      deletedDirectory: false,
      changedVerifier: false,
      changedDocument: false,
      changedCacheCode: false,
      legacy: false,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
