/**
 * Puts a CV's Google Fonts on this Mac before Pages opens its DOCX.
 *
 * Pages draws a DOCX with installed fonts only and a .pages file never embeds them, so a family
 * that is not installed turns into a substitute in the converted CV and whenever the .pages file is
 * opened later. `installFonts(families)` copies every style of each missing family as TTF into
 * `~/Library/Application Support/Aeven/Fonts/` (files from `font-files.mjs`) and registers them
 * with CoreText for the user: the registration lasts across logins and tells running apps, so a
 * Pages that is already open sees the fonts. Families the Mac already has are left alone.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { slug } from './fonts.mjs'
import { ttfFaces } from './font-files.mjs'

// Outside ~/Library/Fonts: the font daemon activates files there by itself, after which a CoreText
// registration fails as a duplicate and running apps get no change notification.
export const INSTALL_DIR = join(homedir(), 'Library', 'Application Support', 'Aeven', 'Fonts')

/** Font family names the Mac's font manager offers now. */
function availableFamilies() {
  const script = 'ObjC.import("AppKit"); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join("\\n")'
  return new Set(execFileSync('osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8' }).split('\n').map((f) => f.trim().toLowerCase()))
}

/** The font folder cannot be written, as inside a workspace sandbox. */
export class FontInstallRefused extends Error {
  constructor(dir) {
    super(`writing ${dir} was refused`)
    this.name = 'FontInstallRefused'
  }
}

/**
 * Installs the families this Mac lacks.
 * @param {Iterable<string>} families - font family names a CV's DOCX uses.
 * @returns {Promise<string[]>} the families it installed.
 * @throws {FontInstallRefused} when the font folder cannot be written.
 */
export async function installFonts(families) {
  const have = availableFamilies()
  const missing = [...new Set(families)].filter((f) => f && !have.has(f.toLowerCase()))
  const installed = []
  for (const family of missing) {
    let files
    try {
      files = (await ttfFaces(family)).map((f) => f.file)
    } catch (error) {
      console.warn(`${family}: not installed for Pages (${error.message})`)
      continue
    }
    const targets = files.map((file) => join(INSTALL_DIR, `${slug(family)}-${file.split('/').pop()}`))
    try {
      mkdirSync(INSTALL_DIR, { recursive: true })
      files.forEach((file, i) => copyFileSync(file, targets[i]))
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') throw new FontInstallRefused(INSTALL_DIR)
      throw error
    }
    register(targets)
    installed.push(family)
  }
  return installed
}

/** Registers font files with CoreText for the user, which notifies running apps. */
function register(paths) {
  const script = `ObjC.import('CoreText'); ObjC.import('Foundation')
function run(argv) {
  const urls = $.NSMutableArray.array
  for (const p of argv) urls.addObject($.NSURL.fileURLWithPath(p))
  $.CTFontManagerRegisterFontsForURLs(urls, 2 /* kCTFontManagerScopeUser */, null)
}`
  execFileSync('osascript', ['-l', 'JavaScript', '-e', script, ...paths])
}
