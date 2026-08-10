/**
 * Canonical, machine-readable definition of the HAUZ Authentication schema
 * (Personal Accounts subset) exactly as supplied in the assignment.
 *
 * This module is the single source of truth for:
 *   - `scripts/setup-appwrite.ts`  — provisions the schema into an Appwrite project
 *   - `functions/hauz-account-provisioning` — the only writer of HAUZ rows
 *   - `src/**` — the TanStack Start application (reads only)
 *
 * The assignment states the schema is final: nothing here may be added,
 * removed, renamed or otherwise changed. Keeping it declarative in one file
 * makes that constraint auditable at a glance.
 *
 * It intentionally depends on nothing but `zod` so it can be copied verbatim
 * into the Appwrite Function bundle (see `scripts/sync-function-shared.ts`).
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
  /**
   * Row-level security. Enabled for user-owned tables so a row can grant read
   * access to exactly one Appwrite Auth user; disabled for shared reference data.
   */
  rowSecurity: boolean
  columns: readonly ColumnDef[]
  indexes: readonly IndexDef[]
}

/* -------------------------------------------------------------------------- */
/* The schema                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Declared in dependency order: `accounts` and `personal_roles` must exist
 * before the tables that hold relationship columns pointing at them.
 */
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
      // varchar(36) holding an `account_access_grants.$id`. Deliberately a plain
      // string column, not an Appwrite relationship — see the assignment.
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
    // Reference data: readable by every signed-in user, writable by no client.
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
        // One-to-one already enforces the uniqueness that `uq_personal_account` declares.
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

/**
 * Appwrite system columns present on every row. Structurally identical to
 * `Models.Row` in the SDK, restated here so this module keeps its only
 * dependency on zod and stays usable from the browser.
 */
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
 * A relationship column as Appwrite actually returns it.
 *
 * By default a read yields the related row's id as a plain string. It is
 * expanded into the row itself only when the query asks for it — for example
 * `Query.select(['*', 'account_id.*'])`. Both shapes are modelled here so that
 * reading code cannot quietly assume the wrong one; use `relatedId` to narrow.
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

/**
 * E.164: a leading `+`, a non-zero country code digit, then up to 14 more
 * digits. `personal_accounts.contact_phone` is varchar(20), so the 16-character
 * maximum of E.164 always fits.
 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/

/**
 * The profile data required to materialise a Personal Account.
 *
 * Validated twice on purpose: once at the application edge (where it is also
 * normalised) and once inside the Appwrite Function, which must never trust its
 * caller. `contactPhone` is `null` — not `''` — when absent, because
 * `contact_phone` is a nullable column.
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
 * Request body of the provisioning Function.
 *
 * `profile` is optional: on the initial registration the application supplies
 * it, while a retry (for example after a partial failure, or the first login of
 * an account whose provisioning never completed) omits it and lets the Function
 * recover the values from the Appwrite Auth user's preferences.
 *
 * The Appwrite Auth user id is never part of this payload — the Function reads
 * it from the `x-appwrite-user-id` header that Appwrite derives from the
 * caller's JWT.
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
    | 'role_not_found'
    | 'provisioning_failed'
  message: string
}

export type ProvisionResponse = ProvisionResult | ProvisionError

/**
 * Keys used on the Appwrite Auth user's preferences. Registration stores the
 * profile there so that provisioning can be resumed later without asking the
 * person to type everything again.
 */
export const USER_PREF_KEYS = {
  firstName: 'hauzFirstName',
  lastName: 'hauzLastName',
  role: 'hauzRole',
  contactPhone: 'hauzContactPhone',
} as const

/** Shape of the preferences written at registration time. */
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

/** Returns the profile stored on an Auth user, or `null` when it is absent/invalid. */
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
