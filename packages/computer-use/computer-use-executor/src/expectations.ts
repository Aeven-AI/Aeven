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
 * Substitute placeholders across a match record's values.
 *
 * The semantic expectations match on a record of fields rather than one string, and
 * the same rule has to hold across all of them: a field left unfilled is an error,
 * not a wildcard, so this defers to {@link substitute} per value instead of
 * resolving whatever it can and leaving the rest to match something unintended.
 * @param record - the field values containing placeholders.
 * @param values - the values to substitute.
 * @returns the resolved record.
 * @throws {ComputerUseError} `invalid-target` when a placeholder has no value.
 */
function substituteRecord(
  record: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, substitute(value, values)]))
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
  return expectations.map((expectation): Expectation => {
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
      case 'appObject':
        // A recipe names the application object it expects — a calendar holding an
        // event, a note existing — and every one of those values is a caller
        // argument, so the object is only checkable once its placeholders are
        // resolved here, exactly as the filesystem paths above are.
        return {
          kind: 'appObject',
          app: expectation.app,
          collection: expectation.collection,
          match: substituteRecord(expectation.match, values),
        }
      case 'calendarHasEvent': {
        // An optional field the recipe did not name is omitted rather than written
        // as `undefined` (`exactOptionalPropertyTypes`), which also keeps the
        // resolved check identical to the declared one.
        const resolved: Extract<Expectation, { kind: 'calendarHasEvent' }> = {
          kind: 'calendarHasEvent',
          ...expectation.calendar === undefined ? {} : { calendar: substitute(expectation.calendar, values) },
          ...expectation.count === undefined ? {} : { count: expectation.count },
        }
        if (expectation.match === undefined) {
          return resolved
        }
        return { ...resolved, match: substituteRecord(expectation.match, values) }
      }
      case 'noteExists': {
        const resolved: Extract<Expectation, { kind: 'noteExists' }> = {
          kind: 'noteExists',
          name: substitute(expectation.name, values),
          ...expectation.folder === undefined ? {} : { folder: substitute(expectation.folder, values) },
        }
        if (expectation.contains === undefined) {
          return resolved
        }
        return { ...resolved, contains: substitute(expectation.contains, values) }
      }
    }
    // Unreachable while the switch covers every kind, which is the point: a new
    // expectation kind added to the union fails to compile here rather than falling
    // through, because a check this function silently stopped resolving would be a
    // verification that cannot fail. The switch narrows the value to `never`, so the
    // message reads the kind back through the union it came from.
    /* v8 ignore next 3 -- Expectation is a closed union and every member returns above. */
    throw new ComputerUseError('invalid-target', `the resolver does not handle the "${(expectation as Expectation).kind}" expectation`)
  })
}
