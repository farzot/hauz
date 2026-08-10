/**
 * Turns Appwrite failures into something a person can act on. The browser is
 * told what to do next, never what went wrong internally, and anything
 * unrecognised becomes a generic message so a change in Appwrite's error text
 * cannot leak infrastructure detail into the UI.
 *
 * The shape these produce lives in `shared/action-result.ts`; only the mapping
 * is here, because only this half of the app may import the Appwrite SDK.
 */
import { AppwriteException } from 'node-appwrite'

import type { ActionError } from '../../shared/action-result'

type Mapping = {
  message: string
  field?: ActionError['field']
  retryable?: boolean
}

/** Keyed by Appwrite's `type`, which is stable, not by its message. */
const BY_TYPE: Record<string, Mapping> = {
  user_already_exists: {
    message: 'An account with this email address already exists. Try signing in instead.',
    field: 'email',
  },
  user_email_already_exists: {
    message: 'An account with this email address already exists. Try signing in instead.',
    field: 'email',
  },
  user_invalid_credentials: {
    message: 'That email address and password do not match an account.',
    field: 'password',
  },
  user_blocked: {
    message: 'This account has been blocked. Contact support to restore access.',
  },
  user_not_found: {
    message: 'That email address and password do not match an account.',
    field: 'email',
  },
  user_password_mismatch: {
    message: 'The passwords do not match.',
    field: 'password',
  },
  password_personal_data: {
    message: 'Choose a password that does not contain your name or email address.',
    field: 'password',
  },
  general_argument_invalid: {
    message: 'Some of the details you entered are not valid. Check the form and try again.',
  },
  general_rate_limit_exceeded: {
    message: 'Too many attempts. Wait a minute before trying again.',
    retryable: true,
  },
  user_invalid_token: {
    message: 'This verification link is invalid or has already been used. Request a new one.',
  },
  user_email_already_verified: {
    message: 'This email address is already verified.',
  },
  user_session_already_exists: {
    message: 'You are already signed in.',
  },
}

/** Falls back on the HTTP status when the error type is unknown. */
const BY_STATUS: Record<number, Mapping> = {
  401: { message: 'Your session has expired. Sign in again.' },
  409: { message: 'That conflicts with something that already exists.' },
  429: {
    message: 'Too many attempts. Wait a minute before trying again.',
    retryable: true,
  },
  500: {
    message: 'Appwrite could not complete the request. Try again shortly.',
    retryable: true,
  },
  503: {
    message: 'Appwrite is temporarily unavailable. Try again shortly.',
    retryable: true,
  },
}

const GENERIC: Mapping = {
  message: 'Something went wrong. Try again.',
  retryable: true,
}

export function toActionError(error: unknown, fallback?: Partial<Mapping>): ActionError {
  if (error instanceof AppwriteException) {
    const mapping = BY_TYPE[error.type] ?? BY_STATUS[error.code] ?? { ...GENERIC, ...fallback }
    return {
      code: error.type || `http_${error.code}`,
      message: mapping.message,
      field: mapping.field,
      retryable: mapping.retryable,
    }
  }

  return {
    code: 'unexpected_error',
    message: fallback?.message ?? GENERIC.message,
    retryable: fallback?.retryable ?? true,
  }
}

/** `true` when Appwrite says the caller is not (or is no longer) authenticated. */
export function isUnauthenticated(error: unknown): boolean {
  return (
    error instanceof AppwriteException && (error.code === 401 || error.type === 'user_jwt_invalid')
  )
}

/**
 * `true` when Appwrite rejected the verification secret rather than the caller:
 * an expired, altered or already-used link. Both arrive as HTTP 401, so the
 * status alone cannot tell them apart from "you are not signed in", and the
 * difference decides what the person is told.
 */
export function isVerificationTokenRejected(error: unknown): boolean {
  return (
    error instanceof AppwriteException &&
    (error.type === 'user_invalid_token' || error.type === 'user_email_already_verified')
  )
}

/** For the server log, never for the browser. */
export function describeForLog(error: unknown): string {
  if (error instanceof AppwriteException) {
    return `AppwriteException ${error.code} ${error.type || 'unknown'}: ${error.message}`
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
