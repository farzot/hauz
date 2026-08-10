/**
 * Server functions backing the three features: registration, login, logout.
 *
 * Everything here runs on the server only. The browser sees the arguments it
 * sends and the result it gets back — never an API key, never an Appwrite
 * endpoint, never a session secret.
 *
 * Actions return a discriminated `ActionResult` rather than throwing, so forms
 * can render a precise message (and highlight the offending field) instead of
 * falling into an error boundary. `redirectTo` tells the caller where the
 * person belongs next; route guards enforce the same rule independently, so a
 * client that ignores it still cannot reach a page it should not.
 */
import { createServerFn } from '@tanstack/react-start'
import { ID } from 'node-appwrite'

import {
  VERIFICATION_RESEND_INTERVAL_SECONDS,
  profileToPrefs,
  secondsUntilResendAllowed,
} from '../../shared/hauz-schema'
import type { PersonalProfile, ProvisionResponse } from '../../shared/hauz-schema'
import { adminClient, sessionClient } from '../lib/appwrite/clients.server'
import { describeForLog, fail, ok, toActionError } from '../lib/appwrite/errors'
import type { ActionResult } from '../lib/appwrite/errors'
import { confirmVerification, sendVerificationEmail } from '../lib/email/verification.server'
import { env } from '../lib/env.server'
import { provisionHauzAccount } from '../lib/hauz/hauz.server'
import { landingPathFor } from '../lib/auth/model'
import type { AppPath, AuthState } from '../lib/auth/model'
import { loginSchema, registerSchema, verificationCallbackSchema } from '../lib/auth/schemas'
import {
  clearSessionCookie,
  readSessionSecret,
  writeSessionSecret,
} from '../lib/auth/session.server'
import { resolveAuthState } from '../lib/auth/state.server'
import { getRequestUrl } from '@tanstack/react-start/server'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type Redirection = { redirectTo: AppPath }

/**
 * Where Appwrite should send people back to from the verification email.
 *
 * Falls back to the origin of the current request so the app works on
 * localhost, on a preview URL and in production without being told. The
 * hostname must still be registered as a Web platform in the Appwrite console;
 * Appwrite rejects anything else, which is what stops this from being an open
 * redirect.
 */
function verificationReturnUrl(): string {
  const configured = env().APP_URL
  const origin = configured ?? getRequestUrl().origin
  return new URL('/verify', origin).toString()
}

/** Attempts provisioning and reports it without leaking Appwrite internals. */
function provisioningError(result: Extract<ProvisionResponse, { ok: false }>) {
  console.error(`[auth] provisioning refused: ${result.code} — ${result.message}`)
  return fail({
    code: result.code,
    message:
      result.code === 'missing_profile'
        ? 'We could not find the details from your registration. Register again to continue.'
        : 'Your account was created, but setting up your HAUZ records did not finish.',
    retryable: true,
  })
}

/* -------------------------------------------------------------------------- */
/* Reading the current state                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Used by the root route on every navigation, so the shell and every guard
 * always work from a session Appwrite has just confirmed rather than from
 * something cached in the browser.
 */
export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthState> => resolveAuthState(),
)

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export type RegisterOutcome = Redirection & {
  /** `false` when the account exists but Appwrite could not send the email. */
  verificationSent: boolean
}

/**
 * Registration, in the order the pieces depend on each other:
 *
 *   1. create the Appwrite Auth user — the identity that owns the email address
 *   2. store the profile on that user, so an interrupted run can be resumed
 *   3. open a session, which is what lets steps 4 and 5 act as this person
 *   4. create the HAUZ records through the provisioning Function
 *   5. send the verification email
 *
 * Registration is only reported as complete when steps 1–4 succeeded. If step 4
 * fails the person is not stranded: they are signed in and sent to
 * `/complete-registration`, which retries. If step 5 fails they land on
 * `/verify-email`, which says plainly that registration is unfinished and
 * offers to send the email again.
 */
export const registerFn = createServerFn({ method: 'POST' })
  .validator(registerSchema)
  .handler(async ({ data }): Promise<ActionResult<RegisterOutcome>> => {
    const profile: PersonalProfile = {
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      contactPhone: data.contactPhone,
    }

    const { users, account: adminAccount } = adminClient()

    // 1. The Appwrite Auth user. Not a HAUZ row, so Appwrite's own id format is
    //    the right choice here — generated UUIDs are for HAUZ rows.
    let userId: string
    try {
      const user = await users.create({
        userId: ID.unique(),
        email: data.email,
        password: data.password,
        name: `${data.firstName} ${data.lastName}`,
      })
      userId = user.$id
    } catch (error) {
      console.error(`[auth] could not create the Auth user: ${describeForLog(error)}`)
      return fail(toActionError(error))
    }

    // 2. Recovery data for a later resume. A failure here is not worth losing a
    //    registration over — provisioning still receives the profile directly.
    try {
      await users.updatePrefs({ userId, prefs: profileToPrefs(profile) })
    } catch (error) {
      console.error(`[auth] could not store profile preferences: ${describeForLog(error)}`)
    }

    // 3. Session.
    let sessionSecret: string
    try {
      const session = await adminAccount.createEmailPasswordSession({
        email: data.email,
        password: data.password,
      })
      sessionSecret = session.secret
      writeSessionSecret(session.secret, session.expire)
    } catch (error) {
      console.error(`[auth] could not open a session after signup: ${describeForLog(error)}`)
      return fail(toActionError(error))
    }

    // 4. HAUZ records.
    let provisioned: ProvisionResponse
    try {
      provisioned = await provisionHauzAccount(sessionSecret, profile)
    } catch (error) {
      console.error(`[auth] provisioning threw: ${describeForLog(error)}`)
      return fail(
        toActionError(error, {
          message: 'Your account was created, but setting up your HAUZ records did not finish.',
        }),
      )
    }
    if (!provisioned.ok) return provisioningError(provisioned)

    // 5. Verification email.
    let verificationSent = true
    try {
      await sendVerificationEmail({
        sessionSecret,
        userId,
        email: data.email,
        name: `${data.firstName} ${data.lastName}`,
        returnUrl: verificationReturnUrl(),
        prefs: profileToPrefs(profile),
      })
    } catch (error) {
      verificationSent = false
      console.error(`[auth] could not send the verification email: ${describeForLog(error)}`)
    }

    return ok({ redirectTo: '/verify-email', verificationSent })
  })

/**
 * Retries provisioning for someone who is signed in but has no HAUZ records.
 * The profile is recovered inside the Function from the Auth user's
 * preferences, so nothing has to be typed again.
 */
export const completeRegistrationFn = createServerFn({
  method: 'POST',
}).handler(async (): Promise<ActionResult<Redirection>> => {
  const sessionSecret = readSessionSecret()
  if (!sessionSecret) return ok({ redirectTo: '/login' })

  let provisioned: ProvisionResponse
  try {
    provisioned = await provisionHauzAccount(sessionSecret)
  } catch (error) {
    console.error(`[auth] provisioning retry threw: ${describeForLog(error)}`)
    return fail(
      toActionError(error, {
        message: 'Setting up your HAUZ records did not finish.',
      }),
    )
  }
  if (!provisioned.ok) return provisioningError(provisioned)

  return ok({ redirectTo: landingPathFor(await resolveAuthState()) })
})

/* -------------------------------------------------------------------------- */
/* Email verification                                                          */
/* -------------------------------------------------------------------------- */

export type ResendOutcome = {
  /** `false` when the interval has not elapsed and nothing was sent. */
  sent: boolean
  /** Seconds the caller must wait before asking again. */
  retryAfterSeconds: number
}

/**
 * Sends another verification email, no more often than once per
 * {@link VERIFICATION_RESEND_INTERVAL_SECONDS}.
 *
 * The limit is enforced here rather than only in the page. A countdown in the
 * browser is a courtesy to the person using it; it stops nobody from calling
 * this endpoint in a loop, which under the Resend transport would spend quota
 * and fill somebody's inbox. Being early is not an error — the caller is told
 * how long is left and the button keeps counting down.
 */
export const resendVerificationFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ActionResult<ResendOutcome>> => {
    const sessionSecret = readSessionSecret()
    if (!sessionSecret) {
      return fail({
        code: 'unauthenticated',
        message: 'Sign in again to resend the email.',
      })
    }

    try {
      // `account.get()` already carries the preferences, so enforcing the
      // interval costs no extra round trip.
      const user = await sessionClient(sessionSecret).account.get()

      const wait = secondsUntilResendAllowed(user.prefs)
      if (wait > 0) return ok({ sent: false, retryAfterSeconds: wait })

      await sendVerificationEmail({
        sessionSecret,
        userId: user.$id,
        email: user.email,
        name: user.name,
        returnUrl: verificationReturnUrl(),
        prefs: user.prefs,
      })

      return ok({ sent: true, retryAfterSeconds: VERIFICATION_RESEND_INTERVAL_SECONDS })
    } catch (error) {
      console.error(`[auth] resend verification failed: ${describeForLog(error)}`)
      return fail(toActionError(error))
    }
  },
)

export type VerificationOutcome = Redirection

/**
 * Completes verification from the link in the email.
 *
 * The link may well be opened in a browser that has no session — a different
 * device, or a mail client's built-in viewer. Appwrite accepts the `userId` and
 * `secret` pair on its own, so that case is handled without a session; if the
 * deployment insists on one, the caller is told to sign in and is returned here
 * afterwards with the parameters intact.
 */
export const completeVerificationFn = createServerFn({ method: 'POST' })
  .validator(verificationCallbackSchema)
  .handler(async ({ data }): Promise<ActionResult<VerificationOutcome>> => {
    let sessionSecret = readSessionSecret()

    try {
      const result = await confirmVerification({
        userId: data.userId,
        secret: data.secret,
        flow: data.flow,
        sessionSecret,
      })

      // The token flow signs the person in as it verifies, so a link opened on
      // a second device lands them straight in the application.
      if (result.session) {
        sessionSecret = result.session.secret
        writeSessionSecret(result.session.secret, result.session.expiresAt)
      }
    } catch (error) {
      console.error(`[auth] verification failed: ${describeForLog(error)}`)

      if (!sessionSecret) {
        return fail({
          code: 'needs_login',
          message: 'Sign in to finish verifying your email address.',
        })
      }
      return fail(toActionError(error))
    }

    // Re-read rather than assume: verification may have been the last thing
    // standing between this person and the authenticated page, or not.
    return ok({
      redirectTo: sessionSecret ? landingPathFor(await resolveAuthState()) : '/login',
    })
  })

/* -------------------------------------------------------------------------- */
/* Login and logout                                                            */
/* -------------------------------------------------------------------------- */

export const loginFn = createServerFn({ method: 'POST' })
  .validator(loginSchema)
  .handler(async ({ data }): Promise<ActionResult<Redirection>> => {
    let sessionSecret: string
    try {
      const session = await adminClient().account.createEmailPasswordSession({
        email: data.email,
        password: data.password,
      })
      sessionSecret = session.secret
      writeSessionSecret(session.secret, session.expire)
    } catch (error) {
      // Deliberately the same message for "no such user" and "wrong password":
      // login should not reveal which email addresses are registered.
      console.error(`[auth] login failed for ${data.email}: ${describeForLog(error)}`)
      return fail(toActionError(error))
    }

    let state = await resolveAuthState()

    // Self-healing: an account whose registration never finished is repaired on
    // the way in, using the profile stored on the Auth user.
    if (state.status === 'incomplete') {
      try {
        const provisioned = await provisionHauzAccount(sessionSecret)
        if (provisioned.ok) state = await resolveAuthState()
      } catch (error) {
        console.error(`[auth] provisioning during login failed: ${describeForLog(error)}`)
      }
    }

    return ok({ redirectTo: landingPathFor(state) })
  })

/**
 * Ends the session in Appwrite and clears the cookie.
 *
 * The cookie is cleared whatever Appwrite answers. A session that could not be
 * deleted remotely must still not leave the browser holding a usable secret.
 */
export const logoutFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<ActionResult<Redirection>> => {
    const sessionSecret = readSessionSecret()

    if (sessionSecret) {
      try {
        await sessionClient(sessionSecret).account.deleteSession({
          sessionId: 'current',
        })
      } catch (error) {
        console.error(`[auth] could not delete the Appwrite session: ${describeForLog(error)}`)
      }
    }

    clearSessionCookie()
    return ok({ redirectTo: '/login' })
  },
)
