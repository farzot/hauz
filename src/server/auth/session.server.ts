// The Appwrite session secret lives in an httpOnly cookie on our own origin, so
// scripts in the page cannot read it and we do not depend on Appwrite's
// cross-site cookie, which browsers block on a different domain. Reading it on
// the server is also what lets route guards run during SSR.
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

import { env, isProduction } from '../env.server'

/** Appwrite sessions last a year by default. */
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
 * @param expiresAt Appwrite's session expiry (ISO 8601). The cookie gets the
 * same lifetime, so the browser stops sending a secret Appwrite has retired.
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
