/**
 * Input schemas for the authentication flows.
 *
 * Shared by the browser and the server on purpose: the forms get immediate
 * feedback from the same rules the server enforces, and the server still
 * validates every request because a browser is not a trust boundary.
 *
 * Browser-safe — no Node built-ins, no secrets.
 */
import { z } from 'zod'

import { E164_PATTERN, PERSONAL_ROLE } from '../../../shared/hauz-schema'

/** Separators people type into a phone field and never mean as digits. */
const PHONE_SEPARATORS = /[\s()\-.\u00a0]/g

export const PHONE_HELP =
  'Enter the phone number in international format, for example +998901234567.'

/**
 * Optional in the form, `null` in the database — never an empty string.
 *
 * This checks the *shape* only. Whether the number is one anyone could dial is
 * decided on the server by `lib/phone.server.ts`, which owns the numbering-plan
 * metadata and keeps it out of the browser bundle.
 */
const contactPhoneField = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((value) => (value ? value.replace(PHONE_SEPARATORS, '') : null))
  .refine((value) => value === null || E164_PATTERN.test(value), { message: PHONE_HELP })

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
