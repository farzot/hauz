/**
 * Session storage.
 *
 * The Appwrite session secret is kept in an httpOnly, SameSite=Lax cookie on
 * the application's own origin. Two consequences worth stating:
 *
 *   - the secret is never readable by scripts in the page, so XSS cannot lift a
 *     session out of the browser;
 *   - the app does not depend on Appwrite's own cross-site cookie, which
 *     browsers block when the app and Appwrite are on different domains. Staying
 *     signed in across a page refresh therefore works everywhere, including
 *     Safari and Firefox with third-party cookies disabled.
 *
 * Because the cookie is read on the server, route protection happens during
 * SSR: a signed-out visitor is redirected before any authenticated markup is
 * produced, rather than after the page has already reached them.
 */
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

import { env, isProduction } from '../env.server'

/** Appwrite sessions last a year by default; the cookie never outlives the session. */
const FALLBACK_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
  }
}

export function readSessionSecret(): string | undefined {
  return getCookie(env().SESSION_COOKIE_NAME)
}

/**
 * @param expiresAt Appwrite's session expiry, ISO 8601. The cookie is given the
 * same lifetime so the browser stops sending a secret that Appwrite has already
 * retired.
 */
export function writeSessionSecret(secret: string, expiresAt?: string): void {
  let maxAge = FALLBACK_MAX_AGE_SECONDS

  if (expiresAt) {
    const seconds = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
    if (Number.isFinite(seconds) && seconds > 0) maxAge = seconds
  }

  setCookie(env().SESSION_COOKIE_NAME, secret, { ...cookieOptions(), maxAge })
}

export function clearSessionCookie(): void {
  deleteCookie(env().SESSION_COOKIE_NAME, cookieOptions())
}
