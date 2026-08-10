/**
 * What a visitor is, and where each kind of visitor belongs.
 *
 * Registration has three independent outcomes, and any of them can be missing
 * when someone comes back to the site: an Appwrite Auth user, the HAUZ records
 * behind it, and a verified email address. Naming every combination gives each
 * route exactly one correct next step to send people to, instead of leaving it
 * to be inferred from a pair of booleans at each call site.
 *
 * Browser-safe: types and one pure function, so routes and guards can import it
 * without dragging server code into the client bundle.
 */
import type { AccountStatus, AccountType, PersonalRole } from '../../../shared/hauz-schema'

/* -------------------------------------------------------------------------- */
/* Routes the server may redirect to                                           */
/* -------------------------------------------------------------------------- */

/**
 * Typing redirects as a union rather than as `string` means a server function
 * cannot name a page that does not exist: the router rejects it at compile
 * time, and a renamed route breaks the build instead of production.
 */
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

/** The HAUZ Account that user has access to, assembled across the four tables. */
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
  /** Signed in and provisioned, but the email address is unconfirmed. */
  | { status: 'unverified'; user: SessionUser; hauz: HauzProfile }
  /** Fully registered, but the HAUZ Account is blocked or terminated. */
  | { status: 'blocked'; user: SessionUser; hauz: HauzProfile }
  /** Fully registered and allowed in. */
  | { status: 'ready'; user: SessionUser; hauz: HauzProfile }

export type AuthStatus = AuthState['status']

/** The single page each state belongs on. Used by route guards and after every auth action. */
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
