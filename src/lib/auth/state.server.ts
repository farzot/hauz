/**
 * Turns a session cookie into an {@link AuthState}.
 *
 * Every route guard and every auth action funnels through this one function, so
 * there is a single definition of "signed in" in the system rather than one per
 * page.
 */
import { sessionClient } from '../appwrite/clients.server'
import { describeForLog, isUnauthenticated } from '../appwrite/errors'
import { readHauzProfile } from '../hauz/hauz.server'
import type { AuthState, SessionUser } from './model'
import { clearSessionCookie, readSessionSecret } from './session.server'

const ANONYMOUS: AuthState = { status: 'anonymous' }

/**
 * Reads the session cookie and asks Appwrite who it belongs to.
 *
 * A rejected session clears the cookie on the way out, so an expired or
 * remotely-revoked session cannot leave the browser stuck in a signed-in shell.
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
    // A transport or outage failure is not a signed-out user; surfacing it beats
    // silently logging someone out.
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

  // Checked before verification: an account with no HAUZ records is not
  // registered yet, whatever the state of its email address.
  if (!hauz) return { status: 'incomplete', user: sessionUser }

  if (!sessionUser.emailVerified) return { status: 'unverified', user: sessionUser, hauz }

  if (hauz.accountStatus === 'blocked' || hauz.terminatedAt !== null) {
    return { status: 'blocked', user: sessionUser, hauz }
  }

  return { status: 'ready', user: sessionUser, hauz }
}
