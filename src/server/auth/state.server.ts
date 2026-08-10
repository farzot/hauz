// Cookie -> AuthState. Every route guard and every action goes through here, so
// "signed in" is defined once, not per page.
import { sessionClient } from '../appwrite/clients.server'
import { describeForLog, isUnauthenticated } from '../appwrite/errors.server'
import { readHauzProfile } from '../hauz.server'
import type { AuthState, SessionUser } from '../../shared/auth-model'
import { clearSessionCookie, readSessionSecret } from './session.server'

const ANONYMOUS: AuthState = { status: 'anonymous' }

/**
 * A session Appwrite rejects clears the cookie on the way out, so an expired or
 * remotely revoked one cannot leave the browser stuck in a signed-in shell.
 */
export async function resolveAuthState(): Promise<AuthState> {
  const secret = readSessionSecret()
  if (!secret) return ANONYMOUS

  let user
  try {
    user = await sessionClient(secret).account.get()
  } catch (error) {
    if (isUnauthenticated(error)) {
      clearSessionCookie()
      return ANONYMOUS
    }
    // An outage is not a signed-out user; better to surface it than to log
    // someone out silently.
    console.error(`[auth] could not load the current account: ${describeForLog(error)}`)
    throw error
  }

  const sessionUser: SessionUser = {
    id: user.$id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerification,
  }

  const hauz = await readHauzProfile(secret, user.$id)

  // Order matters. No HAUZ records means not registered yet, whatever the email
  // says; and a blocked account should not be invited to confirm its address or
  // be able to send itself more email.
  if (!hauz) return { status: 'incomplete', user: sessionUser }

  if (hauz.accountStatus === 'blocked' || hauz.terminatedAt !== null) {
    return { status: 'blocked', user: sessionUser, hauz }
  }

  if (!sessionUser.emailVerified) return { status: 'unverified', user: sessionUser, hauz }

  return { status: 'ready', user: sessionUser, hauz }
}
