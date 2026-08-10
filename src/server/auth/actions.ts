/**
 * Registration, login and logout: the server functions the pages call.
 *
 * The only module under `server/` that `client/` may import, which is why it is
 * not named `*.server.ts` like its neighbours: TanStack Start's import
 * protection would refuse to bundle it, and pages need `loginFn`. The bodies
 * still never reach the browser; each one is replaced by an RPC call at build
 * time.
 *
 * Actions return an `ActionResult` instead of throwing, so a form can show a
 * message next to the right field instead of hitting an error boundary.
 * `redirectTo` says where the person goes next; route guards check the same
 * thing independently, so ignoring it gets a client nowhere.
 */
import { createServerFn } from '@tanstack/react-start'
import { ID } from 'node-appwrite'

import {
  VERIFICATION_RESEND_INTERVAL_SECONDS,
  profileToPrefs,
  secondsUntilResendAllowed,
  verificationEverSent,
} from '../../../shared/hauz-schema'
import type { PersonalProfile, ProvisionResponse } from '../../../shared/hauz-schema'
import { fail, ok } from '../../shared/action-result'
import type { ActionResult } from '../../shared/action-result'
import { adminClient, sessionClient } from '../appwrite/clients.server'
import {
  describeForLog,
  isVerificationTokenRejected,
  toActionError,
} from '../appwrite/errors.server'
import { confirmVerification, sendVerificationEmail } from './verification.server'
import { env } from '../env.server'
import { provisionHauzAccount } from '../hauz.server'
import { landingPathFor } from '../../shared/auth-model'
import type { AppPath, AuthState } from '../../shared/auth-model'
import {
  PHONE_HELP,
  loginSchema,
  registerSchema,
  verificationCallbackSchema,
} from '../../shared/auth-schemas'
import { toE164 } from '../phone.server'
import { clearSessionCookie, readSessionSecret, writeSessionSecret } from './session.server'
import { resolveAuthState } from './state.server'
import { getRequestUrl } from '@tanstack/react-start/server'

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type Redirection = { redirectTo: AppPath }

/**
 * Where the verification email points back to. Falls back to the origin of the
 * current request, so localhost and preview deployments work unconfigured.
 * Appwrite rejects a hostname that is not a registered Web platform, which is
 * what keeps this from being an open redirect.
 */
function verificationReturnUrl(): string {
  const configured = env().APP_URL
  const origin = configured ?? getRequestUrl().origin
  return new URL('/verify', origin).toString()
}

// Refusals a retry cannot fix. Everything else gets the generic message below.
const PROVISIONING_MESSAGES: Partial<
  Record<Extract<ProvisionResponse, { ok: false }>['code'], string>
> = {
  // The details were never stored on the Auth user and there is nowhere else to
  // get them. Registering again does not help either: the email is taken by
  // this same account.
  missing_profile:
    'We could not recover the details from your registration, and this account cannot be ' +
    'completed without them. Contact support so it can be reset.',
  // Reinstating a revoked grant is an operator decision, not a retry.
  access_revoked:
    'Access to this HAUZ Account has been revoked. Contact support to have it restored.',
}

/** Reports a refusal from the provisioning Function without leaking internals. */
function provisioningError(result: Extract<ProvisionResponse, { ok: false }>) {
  console.error(`[auth] provisioning refused: ${result.code}: ${result.message}`)
  return fail({
    code: result.code,
    message:
      PROVISIONING_MESSAGES[result.code] ??
      'Your account was created, but setting up your HAUZ records did not finish.',
    retryable: result.code !== 'missing_profile' && result.code !== 'access_revoked',
  })
}

/**
 * Sends the verification email for an account provisioned late, by
 * `/complete-registration` or by logging in. Registration sends it as its last
 * step, so a run that stopped earlier never got there and the person would sit
 * on `/verify-email` waiting for nothing.
 *
 * Only ever the first one; later sends are a deliberate click. Returns `false`
 * only when a send was attempted and failed.
 */
async function sendFirstVerificationEmail(sessionSecret: string): Promise<boolean> {
  try {
    const user = await sessionClient(sessionSecret).account.get()
    if (user.emailVerification || verificationEverSent(user.prefs)) return true

    await sendVerificationEmail({
      sessionSecret,
      userId: user.$id,
      email: user.email,
      name: user.name,
      returnUrl: verificationReturnUrl(),
      prefs: user.prefs,
    })
    return true
  } catch (error) {
    console.error(`[auth] could not send the first verification email: ${describeForLog(error)}`)
    return false
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the current state                                                   */
/* -------------------------------------------------------------------------- */

/** Called by the root route on every navigation, so guards work from a session
 * Appwrite has just confirmed, not something cached in the browser. */
export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthState> => resolveAuthState(),
)

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export type RegisterOutcome = Redirection & {
  /** `false` when the email did not go out, so the page can say so. */
  verificationSent: boolean
}

/**
 * The five steps, in the order they depend on each other:
 *
 *   1. create the Appwrite Auth user
 *   2. store the profile on it, so an interrupted run can be resumed
 *   3. open a session, which lets steps 4 and 5 act as this person
 *   4. create the HAUZ records through the provisioning Function
 *   5. send the verification email
 *
 * Only 1–4 count as registration. If step 4 fails the person is signed in and
 * sent to `/complete-registration` to retry; if step 5 fails they land on
 * `/verify-email`, which offers to send it again. Neither page claims success.
 */
export const registerFn = createServerFn({ method: 'POST' })
  .validator(registerSchema)
  .handler(async ({ data }): Promise<ActionResult<RegisterOutcome>> => {
    // The route guard covers the form; this covers the endpoint. Without it a
    // repeated POST creates a second Auth user and moves the cookie to it,
    // orphaning the account they were using.
    if (readSessionSecret()) {
      const current = await resolveAuthState()
      if (current.status !== 'anonymous') {
        return ok({ redirectTo: landingPathFor(current), verificationSent: true })
      }
    }

    // The form checked the shape; whether the number is real is decided here.
    let contactPhone: string | null = null
    if (data.contactPhone !== null) {
      contactPhone = toE164(data.contactPhone)
      if (contactPhone === null) {
        return fail({ code: 'invalid_phone', field: 'contactPhone', message: PHONE_HELP })
      }
    }

    const profile: PersonalProfile = {
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      contactPhone,
    }

    const { users, account: adminAccount } = adminClient()

    // 1. Not a HAUZ row, so Appwrite's own id format is right here. Generated
    //    UUIDs are for HAUZ rows.
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

    // 2. Recovery data. Not worth failing a registration over: provisioning
    //    gets the profile directly anyway.
    let profileStored = true
    try {
      await users.updatePrefs({ userId, prefs: profileToPrefs(profile) })
    } catch (error) {
      profileStored = false
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
    let provisioned: ProvisionResponse | null = null
    try {
      provisioned = await provisionHauzAccount(sessionSecret, profile)
    } catch (error) {
      console.error(`[auth] provisioning threw: ${describeForLog(error)}`)
    }

    if (!provisioned?.ok) {
      if (provisioned) {
        console.error(`[auth] provisioning refused: ${provisioned.code}: ${provisioned.message}`)
      }

      // The stored profile is the only copy that outlives this request, and the
      // retry on the next page reads it. Step 2 was allowed to fail quietly;
      // now that it matters, try again.
      if (!profileStored) {
        try {
          await users.updatePrefs({ userId, prefs: profileToPrefs(profile) })
        } catch (error) {
          console.error(`[auth] profile preferences still unwritable: ${describeForLog(error)}`)
        }
      }

      // They are signed in, so send them to the page that can finish the job
      // instead of leaving them on a form with an error and no way forward.
      return ok({ redirectTo: '/complete-registration', verificationSent: false })
    }

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

export type CompleteRegistrationOutcome = Redirection & {
  /** `false` when the first verification email was attempted here and failed. */
  verificationSent: boolean
}

/**
 * Retries provisioning for someone signed in with no HAUZ records. The Function
 * recovers the profile from the Auth user's preferences, so nothing has to be
 * typed again. Registration never reached its email step either, so sending
 * that email is part of finishing the job.
 */
export const completeRegistrationFn = createServerFn({
  method: 'POST',
}).handler(async (): Promise<ActionResult<CompleteRegistrationOutcome>> => {
  const sessionSecret = readSessionSecret()
  if (!sessionSecret) return ok({ redirectTo: '/login', verificationSent: true })

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

  const state = await resolveAuthState()

  // The Function says the rows exist and we still cannot read them: almost
  // always row security switched off on a table. Say so, rather than redirect
  // back to this same page and look like a button that does nothing.
  if (state.status === 'incomplete') {
    console.error(
      '[auth] provisioning reported success but the HAUZ records are still not readable ' +
        'for this session; check row security on the three user tables',
    )
    return fail({
      code: 'records_unreadable',
      message:
        'Your records were created, but this application cannot read them back. ' +
        'The server log has the detail.',
      retryable: true,
    })
  }

  const verificationSent = await sendFirstVerificationEmail(sessionSecret)

  return ok({ redirectTo: landingPathFor(state), verificationSent })
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
 * At most one email per {@link VERIFICATION_RESEND_INTERVAL_SECONDS}, enforced
 * here and not only by the countdown in the page: a countdown stops nobody from
 * calling this in a loop. Being early is not an error; the caller is told how
 * long is left.
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
 * Completes verification from the link in the email, which is often opened in a
 * browser with no session: another device, or a mail client's own viewer.
 * Appwrite accepts the userId/secret pair on its own, so that works; if a
 * deployment insists on a session, the caller is sent to sign in and comes back
 * here with the parameters intact.
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
      // a second device lands them straight in.
      if (result.session) {
        sessionSecret = result.session.secret
        writeSessionSecret(result.session.secret, result.session.expiresAt)
      }
    } catch (error) {
      console.error(`[auth] verification failed: ${describeForLog(error)}`)

      // A single-use link opened twice fails the second time even though the
      // first worked, so check the account before reporting a failure to
      // someone who is already verified.
      if (sessionSecret) {
        const state = await resolveAuthState()
        if (state.status !== 'anonymous' && state.user.emailVerified) {
          return ok({ redirectTo: landingPathFor(state) })
        }
        return fail(toActionError(error))
      }

      // No session. Offering to sign in only helps if that was what was
      // missing; a link Appwrite refused outright cannot be revived by it.
      if (isVerificationTokenRejected(error)) return fail(toActionError(error))

      return fail({
        code: 'needs_login',
        message: 'Sign in to finish verifying your email address.',
      })
    }

    // Re-read: verification may or may not have been the last thing standing
    // between this person and the dashboard.
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

    // Self-healing: an unfinished registration is repaired on the way in, from
    // the profile stored on the Auth user, and gets the email it never sent.
    if (state.status === 'incomplete') {
      try {
        const provisioned = await provisionHauzAccount(sessionSecret)
        if (provisioned.ok) {
          await sendFirstVerificationEmail(sessionSecret)
          state = await resolveAuthState()
        }
      } catch (error) {
        console.error(`[auth] provisioning during login failed: ${describeForLog(error)}`)
      }
    }

    return ok({ redirectTo: landingPathFor(state) })
  })

/**
 * The cookie is cleared whatever Appwrite answers: a session that could not be
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
