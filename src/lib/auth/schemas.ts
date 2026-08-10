/**
 * Input schemas for the authentication flows.
 *
 * Shared by the browser and the server on purpose: the forms get immediate
 * feedback from the same rules the server enforces, and the server still
 * validates every request because a browser is not a trust boundary.
 *
 * Browser-safe — no Node built-ins, no secrets.
 */
import parsePhoneNumber from 'libphonenumber-js'
import { z } from 'zod'

import { E164_PATTERN, PERSONAL_ROLE } from '../../../shared/hauz-schema'

/**
 * Normalises a phone number to E.164, or returns `null` when it is not a real,
 * dialable number. Requires an international prefix: without a country there is
 * nothing to normalise against, and storing an ambiguous number would be worse
 * than rejecting it.
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

const PHONE_HELP = 'Enter the phone number in international format, for example +998901234567.'

/** Optional in the form, `null` in the database — never an empty string. */
const contactPhoneField = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value ? value : null))
  .superRefine((value, ctx) => {
    if (value !== null && toE164(value) === null) {
      ctx.addIssue({ code: 'custom', message: PHONE_HELP })
    }
  })
  .transform((value) => (value === null ? null : toE164(value)))

const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(320)
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'))

/** Appwrite requires at least 8 characters and accepts at most 265. */
const passwordField = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(265, 'Passwords can be at most 265 characters.')

const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(100, `Keep your ${label} under 100 characters.`)

export const registerSchema = z.object({
  firstName: nameField('first name'),
  lastName: nameField('last name'),
  email: emailField,
  password: passwordField,
  role: z.enum(PERSONAL_ROLE, {
    error: 'Choose whether you are a consumer or a realtor.',
  }),
  contactPhone: contactPhoneField,
})

export type RegisterInput = z.input<typeof registerSchema>
export type RegisterValues = z.output<typeof registerSchema>

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password.'),
})

export type LoginInput = z.input<typeof loginSchema>

/** Query parameters Appwrite appends to the verification link. */
export const verificationCallbackSchema = z.object({
  userId: z.string().min(1),
  secret: z.string().min(1),
  /**
   * Which transport produced the link. Appwrite's own emails carry only
   * `userId` and `secret`, so an absent value means the Appwrite flow.
   */
  flow: z.enum(['appwrite', 'token']).default('appwrite'),
})

/**
 * Only same-origin paths may be used as a post-login destination, which rules
 * out using `?next=` as an open redirect.
 */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}
