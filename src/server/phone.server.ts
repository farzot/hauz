// Server-only: libphonenumber's numbering-plan metadata is ~70 KB, too much to
// ship to the browser for one optional field. The form checks the E.164 shape;
// whether the number is dialable is decided here.
import parsePhoneNumber from 'libphonenumber-js'

import { E164_PATTERN } from '../../shared/hauz-schema'

/**
 * Normalises to E.164, or `null` if the number is not a real one.
 *
 * An international prefix is required: without a country there is nothing to
 * normalise against, and an ambiguous number is worse than no number.
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('+')) return null

  const parsed = parsePhoneNumber(trimmed)
  if (!parsed || !parsed.isValid()) return null

  // contact_phone is varchar(20), so check that it fits.
  const formatted = parsed.number
  return E164_PATTERN.test(formatted) && formatted.length <= 20 ? formatted : null
}
