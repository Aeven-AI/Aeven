/**
 * The number a reader types to link WhatsApp by phone code. WhatsApp accepts only the international form, so the
 * field pairs a country-code box with the number: the box starts at the browser's own country, and a number typed
 * with `+` or `00` moves its code into the box.
 */

import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'

/** A number split into its country calling code and the rest. */
export interface PhoneParts {
  /** Calling code with its `+`, such as `+31`; `+` alone when unknown. */
  readonly callingCode: string
  /** The number without its country code, as the reader typed it. */
  readonly number: string
}

/**
 * Take the country code out of a typed number when it carries one (`+31 6…` or `0031 6…`).
 * @param typed - the number field's text.
 * @param callingCode - the box's current code, kept when the number carries none.
 * @returns the code for the box and the number for the field.
 */
export function splitPhone(typed: string, callingCode: string): PhoneParts {
  const start = typed.trimStart()
  const international = start.startsWith('00') ? `+${start.slice(2)}` : start
  if (!international.startsWith('+')) return { callingCode, number: typed }
  const parsed = parsePhoneNumberFromString(international.replace('(0)', ''))
  // Still being typed: no country is recognisable yet, so the text stays in the field until one is.
  if (parsed === undefined) return { callingCode, number: international }
  return { callingCode: `+${parsed.countryCallingCode}`, number: parsed.nationalNumber }
}

/**
 * Join the box and the field into the number WhatsApp is asked about. The national trunk `0` (`06…`) and a written
 * `(0)` are dropped.
 * @param callingCode - the box's code, with or without `+`.
 * @param number - the field's number.
 * @returns the number as `+<country><number>`, or undefined when the two do not make a possible number.
 */
export function internationalPhone(callingCode: string, number: string): string | undefined {
  const code = callingCode.replace(/\D/gu, '')
  const national = number.replace('(0)', '').replace(/\D/gu, '').replace(/^0+/u, '')
  if (code === '' || national === '') return undefined
  const parsed = parsePhoneNumberFromString(`+${code}${national}`)
  return parsed?.isPossible() === true ? parsed.number : undefined
}

/**
 * Guess the reader's country calling code from the browser's languages (`nl-NL` → `+31`).
 * @param languages - the browser's preferred language tags, most preferred first.
 * @returns the calling code with its `+`, or `+` alone when no language names a country.
 */
export function guessCallingCode(languages: readonly string[]): string {
  for (const tag of languages) {
    let region: string | undefined
    try {
      region = new Intl.Locale(tag).maximize().region
    } catch {
      // A malformed language tag names no region; the next preference may.
      continue
    }
    if (region === undefined) continue
    try {
      return `+${getCountryCallingCode(region as CountryCode)}`
    } catch {
      // A region without a calling code (an unknown or non-country region); the next preference may have one.
    }
  }
  return '+'
}
