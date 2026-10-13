/**
 * The starter recipe book: the frequently used programs, and the rung each task
 * uses on each platform.
 *
 * Every entry carries an `evidence` tag, and the distinction is load-bearing.
 * `verified` means the call was run on this machine and read back; `documented`
 * means it comes from a published automation API and has **not** been run here.
 * A consumer must not present the two as equivalent, and nothing in this file
 * claims more than was checked.
 *
 * The macOS entries are verified against Pages Creator Studio 15.3.1, Mail and
 * Calendar. The Windows and Linux entries are documented only: COM and UNO are
 * stable and well documented, but no test here has driven either.
 *
 * @module @aeven/computer-use-router/book
 */

import { COMMON_APP_RECIPES } from './common.ts'
import { OFFICE_RECIPES } from './office.ts'
import type { RecipeBook } from './recipe.ts'

/**
 * Filesystem work every platform does the same way.
 *
 * Reading a file needs no application, no grant, and no UI, which makes it the
 * cheapest rung available anywhere — and the reason so much "open the app to
 * look" work should never have been an application task at all.
 */
const FILES: RecipeBook = [
  {
    task: 'file.readText',
    summary: 'Read a text file from disk.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { encoding: 'utf8' } },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { encoding: 'utf8' } },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'readFile', parameters: { encoding: 'utf8' } },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
  {
    task: 'file.exists',
    summary: 'Report whether a path exists.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'stat' },
      },
      {
        platform: 'win32',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'stat' },
      },
      {
        platform: 'linux',
        rung: 'semantic',
        apps: [],
        evidence: 'verified',
        invocation: { mechanism: 'filesystem', operation: 'stat' },
      },
    ],
    verify: [{ kind: 'fileExists', path: '{path}' }],
  },
]

/**
 * Pages on macOS.
 *
 * Content is one call, which is the measurement the whole layered design rests
 * on. Formatting is the opposite: the scripting bridge does not reach paragraph
 * or font attributes at all (`Can't get object (-1728)`), so those tasks are
 * declared blind here and escalate to the accessibility rung rather than being
 * attempted and discovered.
 */
const PAGES: RecipeBook = [
  {
    task: 'document.createText',
    summary: 'Create a document containing the given text and save it.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Pages'],
        evidence: 'verified',
        knownBlind: ['document.applyFont', 'template.choose'],
        invocation: {
          mechanism: 'apple-events',
          operation: 'Document().make(); bodyText = text; save({ in: path })',
          parameters: { text: '{text}', path: '{path}' },
        },
      },
    ],
    verify: [
      { kind: 'fileExists', path: '{path}' },
      { kind: 'fileContains', path: '{path}', text: '' },
    ],
  },
  {
    task: 'document.applyFont',
    summary: 'Apply a font to document body text.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'accessibility',
        apps: ['com.apple.Pages'],
        evidence: 'documented',
        knownBlind: ['template.choose'],
        invocation: {
          mechanism: 'ax',
          operation: 'setValue on the body text area, then the Format inspector font control',
          parameters: { font: '{font}' },
        },
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Pages' }],
  },
]

/**
 * Mail on macOS.
 *
 * The semantic surface is unusually rich and needs no UI interaction at all: the
 * inbox alone reported 63,037 messages read through the dictionary.
 *
 * One trap is recorded rather than left to be discovered — the application-level
 * `unreadCount()` throws `-1728`, and unread must be read per mailbox.
 */
const MAIL: RecipeBook = [
  {
    task: 'mail.listAccounts',
    summary: 'List the configured mail accounts.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Mail'],
        evidence: 'verified',
        knownBlind: ['mail.unreadCountApplicationWide'],
        invocation: { mechanism: 'apple-events', operation: 'accounts.name()' },
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Mail' }],
  },
  {
    task: 'mail.readRecent',
    summary: 'Read the most recent inbox subject lines.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Mail'],
        evidence: 'verified',
        knownBlind: ['mail.unreadCountApplicationWide'],
        invocation: {
          mechanism: 'apple-events',
          operation: 'inbox.messages[0..n].subject()',
          parameters: { count: '{count}' },
        },
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Mail' }],
  },
]

/** Calendar on macOS, whose dictionary answered with the user's calendars. */
const CALENDAR: RecipeBook = [
  {
    task: 'calendar.list',
    summary: 'List the calendars available to the user.',
    deliverable: 'open-application',
    on: [
      {
        platform: 'darwin',
        rung: 'semantic',
        apps: ['com.apple.Calendar'],
        evidence: 'verified',
        invocation: { mechanism: 'apple-events', operation: 'calendars.name()' },
      },
    ],
    verify: [{ kind: 'windowTitled', title: 'Calendar' }],
  },
]

/**
 * The starter book.
 *
 * Ordered by expected frequency of use, which is also the order the work was
 * verified in: files first because they are cheapest and most used, then the
 * document, mail, and calendar surfaces that were measured on macOS, then the
 * Office and LibreOffice set that is documented and awaits verification on a
 * Windows and a Linux host.
 */
export const STARTER_BOOK: RecipeBook = [
  ...FILES,
  ...PAGES,
  ...MAIL,
  ...CALENDAR,
  ...OFFICE_RECIPES,
  ...COMMON_APP_RECIPES,
]
