/**
 * Registration produces three independent things: an Auth user, the HAUZ
 * records, and a verified email. Any of them can be missing when someone comes
 * back. Naming every combination gives each route one correct next step instead
 * of a pair of booleans to reinterpret at each call site.
 */
import type { AccountStatus, AccountType, PersonalRole } from '../../shared/hauz-schema'

/* -------------------------------------------------------------------------- */
/* Routes the server may redirect to                                           */
/* -------------------------------------------------------------------------- */

// A union, not `string`, so a server function cannot name a page that
// does not exist and a renamed route breaks the build, not production.
export const APP_PATHS = [
  '/login',
  '/register',
  '/verify-email',
  '/complete-registration',
  '/blocked',
  '/dashboard',
] as const

export type AppPath = (typeof APP_PATHS)[number]

/* -------------------------------------------------------------------------- */
/* The signed-in person                                                        */
/* -------------------------------------------------------------------------- */

/** The Appwrite Auth user: who logged in. */
export type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

/** The HAUZ Account they have access to, assembled from the four tables. */
export type HauzProfile = {
  accountId: string
  accountType: AccountType
  accountStatus: AccountStatus
  terminatedAt: string | null
  currentAccessGrantId: string | null
  grantId: string
  grantedAt: string
  personalAccountId: string
  firstName: string
  lastName: string
  contactPhone: string | null
  role: PersonalRole
}

export type AuthState =
  /** No session, or one Appwrite no longer accepts. */
  | { status: 'anonymous' }
  /** Signed in, but registration never produced the HAUZ records. */
  | { status: 'incomplete'; user: SessionUser }
  /** Provisioned, but the HAUZ Account is blocked or terminated. Outranks `unverified`. */
  | { status: 'blocked'; user: SessionUser; hauz: HauzProfile }
  /** Signed in and provisioned, but the email address is unconfirmed. */
  | { status: 'unverified'; user: SessionUser; hauz: HauzProfile }
  /** Fully registered and allowed in. */
  | { status: 'ready'; user: SessionUser; hauz: HauzProfile }

export type AuthStatus = AuthState['status']

/** The one page each state belongs on. Used by guards and by every action. */
export function landingPathFor(state: AuthState): AppPath {
  switch (state.status) {
    case 'anonymous':
      return '/login'
    case 'incomplete':
      return '/complete-registration'
    case 'unverified':
      return '/verify-email'
    case 'blocked':
      return '/blocked'
    case 'ready':
      return '/dashboard'
  }
}
