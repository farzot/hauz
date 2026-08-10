/* eslint-disable */
// -----------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from shared/hauz-schema.ts by scripts/sync-shared.ts.
// Edit the original and run `npm run sync:shared`.
// -----------------------------------------------------------------------------
/**
 * The HAUZ Authentication schema exactly as supplied, in one machine-readable
 * place. Used by scripts/setup-appwrite.ts to create it, by the provisioning
 * Function to write rows, and by the app to read them.
 *
 * The assignment states the schema is final, so nothing here may be added,
 * removed or renamed. Keeping it declarative makes that auditable at a glance.
 *
 * Depends on nothing but zod, so it can be copied verbatim into the Function
 * bundle (see scripts/sync-shared.ts).
 */
import { z } from 'zod'

/* -------------------------------------------------------------------------- */
/* Table ids                                                                   */
/* -------------------------------------------------------------------------- */

export const TABLE = {
  accounts: 'accounts',
  accountAccessGrants: 'account_access_grants',
  personalAccounts: 'personal_accounts',
  personalRoles: 'personal_roles',
} as const

export type TableId = (typeof TABLE)[keyof typeof TABLE]

/* -------------------------------------------------------------------------- */
/* Allowed values                                                              */
/* -------------------------------------------------------------------------- */

/** `accounts.account_type` — required and immutable. Only `individual` is in scope. */
export const ACCOUNT_TYPE = ['individual'] as const
export type AccountType = (typeof ACCOUNT_TYPE)[number]

/** `accounts.status` — required, no default. */
export const ACCOUNT_STATUS = ['active', 'blocked'] as const
export type AccountStatus = (typeof ACCOUNT_STATUS)[number]

/** `personal_roles.value` — required, unique, immutable. Seeded as existing data. */
export const PERSONAL_ROLE = ['consumer', 'realtor'] as const
export type PersonalRole = (typeof PERSONAL_ROLE)[number]

/* -------------------------------------------------------------------------- */
/* Column / index definition model                                             */
/* -------------------------------------------------------------------------- */

export type ColumnDef =
  | { key: string; kind: 'string'; size: number; required: boolean }
  | {
      key: string
      kind: 'enum'
      elements: readonly string[]
      required: boolean
    }
  | { key: string; kind: 'datetime'; required: boolean }
  | {
      key: string
      kind: 'relationship'
      relatedTable: TableId
      /** Appwrite `RelationshipType`. */
      type: 'oneToOne' | 'manyToOne'
      /**
       * Always one-way. A two-way relationship would add a reciprocal column to
       * the related table, which would change the provided schema.
       */
      twoWay: false
      /** Appwrite `RelationMutate`. `restrict` keeps deletions explicit. */
      onDelete: 'restrict'
    }

export type IndexDef = {
  key: string
  type: 'key' | 'unique'
  columns: readonly string[]
}

export type TableDef = {
  id: TableId
  name: string
  /** On for user-owned tables, so a row grants read access to one Auth user;
   * off for shared reference data. */
  rowSecurity: boolean
  columns: readonly ColumnDef[]
  indexes: readonly IndexDef[]
}

/* -------------------------------------------------------------------------- */
/* The schema                                                                  */
/* -------------------------------------------------------------------------- */

// Dependency order: accounts and personal_roles must exist before the tables
// whose relationship columns point at them.
export const HAUZ_SCHEMA: readonly TableDef[] = [
  {
    id: TABLE.accounts,
    name: 'Accounts',
    rowSecurity: true,
    columns: [
      {
        key: 'account_type',
        kind: 'enum',
        elements: ACCOUNT_TYPE,
        required: true,
      },
      { key: 'status', kind: 'enum', elements: ACCOUNT_STATUS, required: true },
      { key: 'terminated_at', kind: 'datetime', required: false },
      // varchar(36) holding an account_access_grants.$id. A plain string
      // column, not a relationship, as the assignment specifies.
      {
        key: 'current_access_grant_id',
        kind: 'string',
        size: 36,
        required: false,
      },
    ],
    indexes: [
      {
        key: 'ix_accounts_type_status',
        type: 'key',
        columns: ['account_type', 'status'],
      },
      {
        key: 'ix_accounts_terminated',
        type: 'key',
        columns: ['terminated_at'],
      },
    ],
  },
  {
    id: TABLE.personalRoles,
    name: 'Personal roles',
    // Reference data: readable by any signed-in user, writable by no client.
    rowSecurity: false,
    columns: [{ key: 'value', kind: 'enum', elements: PERSONAL_ROLE, required: true }],
    indexes: [{ key: 'uq_personal_roles_value', type: 'unique', columns: ['value'] }],
  },
  {
    id: TABLE.accountAccessGrants,
    name: 'Account access grants',
    rowSecurity: true,
    columns: [
      { key: 'appwrite_user_id', kind: 'string', size: 36, required: true },
      {
        key: 'account_id',
        kind: 'relationship',
        relatedTable: TABLE.accounts,
        type: 'manyToOne',
        twoWay: false,
        onDelete: 'restrict',
      },
      { key: 'revoked_at', kind: 'datetime', required: false },
    ],
    indexes: [
      {
        key: 'ix_grants_user_access',
        type: 'key',
        columns: ['appwrite_user_id', 'revoked_at'],
      },
      {
        key: 'ix_grants_account_history',
        type: 'key',
        columns: ['account_id', 'revoked_at'],
      },
      {
        key: 'ix_grants_user_account',
        type: 'key',
        columns: ['appwrite_user_id', 'account_id', 'revoked_at'],
      },
    ],
  },
  {
    id: TABLE.personalAccounts,
    name: 'Personal accounts',
    rowSecurity: true,
    columns: [
      {
        key: 'account_id',
        kind: 'relationship',
        relatedTable: TABLE.accounts,
        // One-to-one already enforces what uq_personal_account declares.
        type: 'oneToOne',
        twoWay: false,
        onDelete: 'restrict',
      },
      {
        key: 'role_id',
        kind: 'relationship',
        relatedTable: TABLE.personalRoles,
        type: 'manyToOne',
        twoWay: false,
        onDelete: 'restrict',
      },
      { key: 'first_name', kind: 'string', size: 100, required: true },
      { key: 'last_name', kind: 'string', size: 100, required: true },
      { key: 'contact_phone', kind: 'string', size: 20, required: false },
    ],
    indexes: [
      { key: 'uq_personal_account', type: 'unique', columns: ['account_id'] },
      { key: 'ix_personal_role', type: 'key', columns: ['role_id'] },
      {
        key: 'ix_personal_contact_phone',
        type: 'key',
        columns: ['contact_phone'],
      },
    ],
  },
]

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

/** Appwrite's system columns. Restated rather than imported so this module
 * keeps zod as its only dependency. */
export type RowMeta = {
  $id: string
  $sequence: string
  $tableId: string
  $databaseId: string
  $createdAt: string
  $updatedAt: string
  $permissions: string[]
}

export type AccountRow = RowMeta & {
  account_type: AccountType
  status: AccountStatus
  terminated_at: string | null
  current_access_grant_id: string | null
}

/**
 * A relationship as Appwrite returns it: the related row's id by default, the
 * row itself when the query asked for expansion. Both shapes are modelled so
 * reading code cannot quietly assume the wrong one.
 */
export type Related<TRow> = TRow | string | null

export type AccountAccessGrantRow = RowMeta & {
  appwrite_user_id: string
  account_id: Related<AccountRow>
  revoked_at: string | null
}

export type PersonalRoleRow = RowMeta & {
  value: PersonalRole
}

export type PersonalAccountRow = RowMeta & {
  account_id: Related<AccountRow>
  role_id: Related<PersonalRoleRow>
  first_name: string
  last_name: string
  contact_phone: string | null
}

/** The related row's id, whether the column came back expanded or not. */
export function relatedId(value: Related<RowMeta>): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.$id
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/** E.164: a `+`, a non-zero country digit, then up to 14 more. The 16-character
 * maximum fits contact_phone's varchar(20). */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/

/**
 * Validated twice on purpose: at the application edge, where it is normalised,
 * and again inside the Function, which must not trust its caller.
 */
export const personalProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(PERSONAL_ROLE),
  contactPhone: z.string().regex(E164_PATTERN).max(20).nullable(),
})

export type PersonalProfile = z.infer<typeof personalProfileSchema>

/* -------------------------------------------------------------------------- */
/* Provisioning contract (application <-> Appwrite Function)                   */
/* -------------------------------------------------------------------------- */

/**
 * `profile` is optional: registration supplies it, a retry omits it and lets the
 * Function recover it from the Auth user's preferences. The user id is never in
 * this payload; the Function takes it from the JWT.
 */
export const provisionRequestSchema = z.object({
  profile: personalProfileSchema.optional(),
})

export type ProvisionRequest = z.infer<typeof provisionRequestSchema>

export type ProvisionResult = {
  ok: true
  /** `true` when this call created the records, `false` when they already existed. */
  created: boolean
  accountId: string
  grantId: string
  personalAccountId: string
}

export type ProvisionError = {
  ok: false
  code:
    | 'unauthenticated'
    | 'invalid_request'
    | 'missing_profile'
    /** The Account exists, but the grant that led to it has been revoked. */
    | 'access_revoked'
    | 'role_not_found'
    | 'provisioning_failed'
  message: string
}

export type ProvisionResponse = ProvisionResult | ProvisionError

/** Registration stores the profile here so provisioning can be resumed later
 * without asking the person to type it again. */
export const USER_PREF_KEYS = {
  firstName: 'hauzFirstName',
  lastName: 'hauzLastName',
  role: 'hauzRole',
  contactPhone: 'hauzContactPhone',
  /** When the last verification email went out. On the Auth user rather than in
   * memory, so the limit survives a restart and holds across instances. */
  verificationSentAt: 'hauzVerificationSentAt',
} as const

/** Shared, so the countdown a person sees and the rule the server enforces
 * cannot drift apart. */
export const VERIFICATION_RESEND_INTERVAL_SECONDS = 60

function readVerificationSentAt(prefs: unknown): string | null {
  const raw = (prefs as Record<string, unknown> | null | undefined)?.[
    USER_PREF_KEYS.verificationSentAt
  ]
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/** Distinguishes "waiting for a message" from "waiting for one nobody sent",
 * which is where a registration that stopped early leaves an account. */
export function verificationEverSent(prefs: unknown): boolean {
  return readVerificationSentAt(prefs) !== null
}

/**
 * Seconds before another email may be sent, `0` if now. A missing or unreadable
 * timestamp allows the send: the limit exists to stop repetition, not to lock
 * anyone out of registering.
 */
export function secondsUntilResendAllowed(prefs: unknown, now: number = Date.now()): number {
  const raw = readVerificationSentAt(prefs)
  if (raw === null) return 0

  const sentAt = new Date(raw).getTime()
  if (!Number.isFinite(sentAt)) return 0

  const elapsed = (now - sentAt) / 1000
  // A timestamp in the future means clock skew; do not trust it.
  if (elapsed < 0) return 0

  return Math.max(0, Math.ceil(VERIFICATION_RESEND_INTERVAL_SECONDS - elapsed))
}

/** `verificationSentAt` is deliberately absent: it is bookkeeping, and a
 * missing one must not stop an account recovering its profile. */
export const userPrefsSchema = z.object({
  [USER_PREF_KEYS.firstName]: z.string().trim().min(1).max(100),
  [USER_PREF_KEYS.lastName]: z.string().trim().min(1).max(100),
  [USER_PREF_KEYS.role]: z.enum(PERSONAL_ROLE),
  [USER_PREF_KEYS.contactPhone]: z.string().regex(E164_PATTERN).max(20).nullable(),
})

export function profileToPrefs(profile: PersonalProfile) {
  return {
    [USER_PREF_KEYS.firstName]: profile.firstName,
    [USER_PREF_KEYS.lastName]: profile.lastName,
    [USER_PREF_KEYS.role]: profile.role,
    [USER_PREF_KEYS.contactPhone]: profile.contactPhone,
  }
}

/** The profile stored on an Auth user, or `null` if absent or invalid. */
export function prefsToProfile(prefs: unknown): PersonalProfile | null {
  const parsed = userPrefsSchema.safeParse(prefs)
  if (!parsed.success) return null
  return {
    firstName: parsed.data[USER_PREF_KEYS.firstName],
    lastName: parsed.data[USER_PREF_KEYS.lastName],
    role: parsed.data[USER_PREF_KEYS.role],
    contactPhone: parsed.data[USER_PREF_KEYS.contactPhone],
  }
}
