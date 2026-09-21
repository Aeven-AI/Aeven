/**
 * Turning a recipe's expectations into checks that can actually be run.
 *
 * A recipe is written once and used for many calls, so its expectations contain
 * placeholders — `{path}`, `{text}` — rather than one caller's literal values.
 * Substitution happens here, immediately before verification, so the check reads
 * the same path the task wrote.
 *
 * A placeholder left unfilled is an **error, not a wildcard**. An expectation
 * that silently checks an empty string would pass on almost anything, which is
 * the failure mode this whole package exists to prevent: a verification that
 * cannot fail is worse than none, because it reports success.
 *
 * @module @aeven/computer-use-executor/expectations
 */

import { ComputerUseError, type Expectation } from '@aeven/computer-use-desktop'

/** Matches a `{name}` placeholder. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

/**
 * Substitute one string's placeholders.
 * @param template - the string containing placeholders.
 * @param values - the values to substitute.
 * @returns the resolved string.
 * @throws {ComputerUseError} `invalid-target` when a placeholder has no value.
 */
export function substitute(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name]
    if (value === undefined) {
      throw new ComputerUseError(
        'invalid-target',
        `the placeholder ${match} has no value, so the check could not be resolved`,
        { placeholder: name, provided: Object.keys(values) },
      )
    }
    return value
  })
}

/**
 * Resolve a recipe's expectations against one call's values.
 * @param expectations - the expectations as the recipe declares them.
 * @param values - the resolved parameters for this call.
 * @returns expectations with every placeholder substituted.
 * @throws {ComputerUseError} `invalid-target` when any placeholder is unfilled.
 */
export function resolveExpectations(
  expectations: readonly Expectation[],
  values: Readonly<Record<string, string>>,
): Expectation[] {
  return expectations.map((expectation) => {
    switch (expectation.kind) {
      case 'fileExists':
        return { kind: 'fileExists', path: substitute(expectation.path, values) }
      case 'fileContains':
        return { kind: 'fileContains', path: substitute(expectation.path, values), text: substitute(expectation.text, values) }
      case 'fileEquals':
        return { kind: 'fileEquals', path: substitute(expectation.path, values), text: substitute(expectation.text, values) }
      case 'fileNewerThan':
        return { kind: 'fileNewerThan', path: substitute(expectation.path, values), sinceMs: expectation.sinceMs }
      case 'nodeValueEquals':
        return { kind: 'nodeValueEquals', token: substitute(expectation.token, values), value: substitute(expectation.value, values) }
      case 'windowTitled':
        return { kind: 'windowTitled', title: substitute(expectation.title, values) }
    }
  })
}
