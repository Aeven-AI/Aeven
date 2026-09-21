/**
 * Recipes for the common applications, curated from the task-intent catalog.
 *
 * Each task here traces to a named end-state check in a public task set, which is
 * why these are worth writing: the check tells us what "done" actually means, so a
 * recipe can carry a real assertion instead of a file-existence stand-in. The
 * catalog is the evidence; this file is the curation.
 *
 * **Three evidence levels appear here, and the difference matters.**
 *
 * - `verified` — run on this machine and read back.
 * - `documented` — a published API and its canonical entry point, not run here.
 * - `unavailable` — no semantic API exists for this task on this platform, so the
 *   recipe says so rather than pretending. `knownBlind` carries the reason and the
 *   rung that would have to be used instead.
 *
 * The Calculator entries are the clearest case of the third kind. macOS Calculator
 * publishes no scripting dictionary, so its display cannot be read
 * programmatically; the *arithmetic* is nonetheless computable exactly through the
 * standard library, and the recipe states that boundary rather than hiding it. A
 * recipe that claimed to read a calculator display it cannot read would be worse
 * than one that admits the gap, because a caller would trust the answer.
 *
 * @module @aeven/computer-use-router/common
 */

import type { RecipeBook } from './recipe.ts'

/**
 * Calculator.
 *
 * The end-state check in the sources is `exact_match` against a displayed result.
 * macOS Calculator cannot be asked for that value — it exposes no scripting
 * dictionary — so the honest semantic path is to compute the value rather than
 * read it off the screen, and to say plainly that screen-verified calculator use
 * needs the accessibility rung.
 */
export const CALCULATOR_RECIPES: RecipeBook = [
  {
    task: 'calculator.compute',
    summary: 'Compute an arithmetic expression and report the result.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Calculator'],
        evidence: 'documented',
        knownBlind: [
          'calculator.readDisplay',
          'calculator.pressKeysOnDisplay',
        ],
        invocation: {
          mechanism: 'filesystem',
          operation: 'evaluate the expression with exact decimal arithmetic',
          parameters: { expression: '{expression}' },
        },
        // No semantic or accessibility rung exists on macOS for reading the
        // Calculator display: the application ships no scripting dictionary and
        // its result is drawn, not published. Screen-verified use needs the vision
        // rung, which this recipe deliberately does not claim.
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Calculator' }],
  },
]

/**
 * Clock.
 *
 * Alarms and timers live in the Clock application's own store, and the sources
 * check them by name — `clock_check_clock_timer_value`, `clock_list_alarms` — so
 * the assertion is against the application's data rather than its pixels.
 */
export const CLOCK_RECIPES: RecipeBook = [
  {
    task: 'clock.createAlarm',
    summary: 'Create an alarm at a given time for named weekdays.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Clock'],
        evidence: 'documented',
        knownBlind: ['clock.alarmSoundSelection'],
        invocation: {
          mechanism: 'apple-events',
          operation: 'Clock: create an alarm with the given label, hour, minute, and weekday set',
          parameters: { label: '{label}', hour: '{hour}', minute: '{minute}', weekdays: '{weekdays}' },
        },
      },
    ],
    verify: [{ kind: 'appObject', app: 'Clock', collection: 'alarms', match: { label: '{label}' } }],
  },
  {
    task: 'clock.listAlarms',
    summary: 'List the configured alarms.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Clock'],
        evidence: 'documented',
        invocation: { mechanism: 'apple-events', operation: 'Clock: list alarms with labels and times' },
      },
    ],
    // A read task must assert that the read worked, not that a window exists: a
    // window titled "Clock" is true whether or not listing succeeded, which would
    // make the check unconditional and therefore worthless.
    verify: [{ kind: 'appObject', app: 'Clock', collection: 'alarms', match: {} }],
  },
  {
    task: 'clock.startTimer',
    summary: 'Start a timer for a duration.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Clock'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Clock: start a timer for the given duration and label',
          parameters: { minutes: '{minutes}', seconds: '{seconds}', label: '{label}' },
        },
      },
    ],
    verify: [{ kind: 'appObject', app: 'Clock', collection: 'timers', match: { label: '{label}' } }],
  },
]

/**
 * Calendar, extended past listing.
 *
 * `calendar_check_weekly_event_advanced` is the check the sources use most for
 * this application, and it names exactly what must be true: an event with a given
 * name, at a given time, recurring on a given weekday. That is a verification a
 * recipe can actually carry.
 */
export const CALENDAR_EVENT_RECIPES: RecipeBook = [
  {
    task: 'calendar.createEvent',
    summary: 'Create a calendar event, optionally recurring on named weekdays.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Calendar'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Calendar: make a new event with summary, start date, end date, and the recurrence',
          parameters: {
            calendar: '{calendar}',
            summary: '{summary}',
            startDate: '{startDate}',
            endDate: '{endDate}',
            recurrence: '{recurrence}',
          },
        },
      },
    ],
    verify: [{ kind: 'calendarHasEvent', calendar: '{calendar}', match: { summary: '{summary}' } }],
  },
  {
    task: 'calendar.createEventInNewCalendar',
    summary: 'Create a named calendar and add at least one event to it.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Calendar'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Calendar: make a new calendar, then make an event in it',
          parameters: { calendar: '{calendar}', summary: '{summary}', startDate: '{startDate}', endDate: '{endDate}' },
        },
      },
    ],
    verify: [
      { kind: 'appObject', app: 'Calendar', collection: 'calendars', match: { name: '{calendar}' } },
      { kind: 'calendarHasEvent', calendar: '{calendar}', count: 1 },
    ],
  },
  {
    task: 'calendar.listEvents',
    summary: 'List the events in a calendar within a date range.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Calendar'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Calendar: read events whose start date falls inside the range',
          parameters: { calendar: '{calendar}', from: '{from}', to: '{to}' },
        },
      },
    ],
    verify: [{ kind: 'appObject', app: 'Calendar', collection: 'calendars', match: { name: '{calendar}' } }],
  },
]

/**
 * Notes, whose checks name the note and the folder it lives in.
 *
 * The strongest signal in the sources for this application is
 * `new_apple_notes_check_note_exists_in_folder` — a note, by name, inside a
 * folder — which is a far better assertion than "the file changed".
 */
export const NOTES_RECIPES: RecipeBook = [
  {
    task: 'notes.createNote',
    summary: 'Create a note with the given body, optionally inside a named folder.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Notes'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Notes: create the folder when named, then make a note with its body',
          parameters: { folder: '{folder}', name: '{name}', body: '{body}' },
        },
      },
    ],
    verify: [{ kind: 'noteExists', name: '{name}', folder: '{folder}' }],
  },
  {
    task: 'notes.readNote',
    summary: 'Read a note body by name.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Notes'],
        evidence: 'documented',
        knownBlind: ['notes.readAttachments'],
        invocation: {
          mechanism: 'apple-events',
          operation: 'Notes: read the plain text of the note with this name',
          parameters: { name: '{name}' },
        },
      },
    ],
    verify: [{ kind: 'noteExists', name: '{name}', contains: '{contains}' }],
  },
  {
    task: 'notes.listNotes',
    summary: 'List the names of the notes in a folder.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Notes'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Notes: list the note names in the named folder',
          parameters: { folder: '{folder}' },
        },
      },
    ],
    verify: [{ kind: 'noteExists', name: '{name}', folder: '{folder}' }],
  },
]

/**
 * Pages, with the template step the sources revealed.
 *
 * The benchmark instructions are explicit that "create a document" means *from a
 * template, with a name* — `Create a new document using the template 'Blank
 * Black' and name it …`. That resolves a problem measured directly on this machine:
 * the Creator Studio template chooser exposes two accessibility elements, and an
 * agent that treats document creation as one call never gets past it. Naming the
 * template makes the step explicit instead of a surprise.
 */
export const PAGES_TEMPLATE_RECIPES: RecipeBook = [
  {
    task: 'document.createFromTemplate',
    summary: 'Create a named document from a named template and write its body text.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        // Measured: the template chooser is not in the accessibility tree, so a
        // template that cannot be chosen through the dictionary needs vision.
        knownBlind: ['template.chooseWhenNotScriptable', 'document.applyFont'],
        invocation: {
          mechanism: 'apple-events',
          operation: 'Pages: create from the named template, set the body text, save under the given name',
          parameters: { template: '{template}', name: '{name}', body: '{body}', path: '{path}' },
        },
      },
    ],
    verify: [{ kind: 'fileContains', path: '{path}', text: '{body}' }],
  },
  {
    task: 'document.findAndReplace',
    summary: 'Replace every occurrence of one string with another in the open document.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        invocation: {
          mechanism: 'apple-events',
          operation: 'Pages: replace every occurrence of the find string with the replacement, then read the body text back',
          parameters: { find: '{find}', replace: '{replace}' },
        },
      },
    ],
    // Asserting the resulting text is the check the sources use, and it is the only
    // one that can fail here: a window titled "Pages" stays titled that whether or
    // not the replacement happened, so it would be an unconditional check.
    verify: [{ kind: 'appObject', app: 'Pages', collection: 'bodyText', match: { contains: '{replace}' } }],
  },
]

/**
 * The common-application set.
 *
 * Grouped so a consumer can mount the applications it needs, and exported whole so
 * the starter book can include everything that has been curated.
 */
export const COMMON_APP_RECIPES: RecipeBook = [
  ...CALCULATOR_RECIPES,
  ...CLOCK_RECIPES,
  ...CALENDAR_EVENT_RECIPES,
  ...NOTES_RECIPES,
  ...PAGES_TEMPLATE_RECIPES,
]
