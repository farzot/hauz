/**
 * Authoritative phone-number validation.
 *
 * Server-only on purpose. Deciding whether `+998901234567` is a number anyone
 * could actually dial takes the full numbering-plan metadata for every country,
 * which is around 70 KB of JavaScript — a large thing to send to every visitor
 * so that one optional field can be checked a few hundred milliseconds sooner.
 *
 * The browser checks the *shape* instead (see `auth/schemas.ts`): separators
 * are stripped and the result must look like E.164. That catches typos
 * immediately. Whether the number is real is settled here, once, on the request
 * that stores it — which is where it had to be settled anyway, since a browser
 * is not a trust boundary.
 */
import parsePhoneNumber from 'libphonenumber-js'

import { E164_PATTERN } from '../../shared/hauz-schema'

/**
 * Normalises a phone number to E.164, or returns `null` when it is not a real,
 * dialable number.
 *
 * Requires an international prefix: without a country there is nothing to
 * normalise against, and storing an ambiguous number would be worse than
 * rejecting it.
 */
export function toE164(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('+')) return null

  const parsed = parsePhoneNumber(trimmed)
  if (!parsed || !parsed.isValid()) return null

  const formatted = parsed.number
  // `contact_phone` is varchar(20); every valid E.164 number fits, but the
  // column limit is checked rather than assumed.
  return E164_PATTERN.test(formatted) && formatted.length <= 20 ? formatted : null
}
