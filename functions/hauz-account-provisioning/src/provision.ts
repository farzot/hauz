/**
 * Creation of the HAUZ records that back one Personal Account.
 *
 * This is the only code in the system that writes to the HAUZ tables. It runs
 * inside an Appwrite Function so that no browser — and no part of the web
 * application — ever holds credentials able to create an account, issue an
 * access grant, or choose an account status.
 */
import { AppwriteException, Permission, Query, Role } from 'node-appwrite'
import type { TablesDB, Users } from 'node-appwrite'

import { registrationRowIds } from './shared/hauz-ids.js'
import { TABLE, prefsToProfile, relatedId } from './shared/hauz-schema.js'
import type {
  AccountAccessGrantRow,
  PersonalProfile,
  PersonalRoleRow,
  ProvisionResponse,
} from './shared/hauz-schema.js'

export type Logger = {
  log: (message: string) => void
  error: (message: string) => void
}

export type ProvisionInput = {
  tablesDB: TablesDB
  users: Users
  databaseId: string
  appwriteUserId: string
  /** Profile supplied by the caller; recovered from user preferences when absent. */
  profile?: PersonalProfile
  logger: Logger
}

/** Transaction lifetime. Generous enough for three writes, short enough to expire cheaply. */
const TRANSACTION_TTL_SECONDS = 60

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function provisionPersonalAccount(input: ProvisionInput): Promise<ProvisionResponse> {
  const { tablesDB, databaseId, appwriteUserId, logger } = input
  const ids = registrationRowIds(appwriteUserId)

  // 1. Already provisioned? An unrevoked grant is the authoritative marker: the
  //    three rows are written atomically, so the grant existing means all of
  //    them exist.
  const existing = await findActiveGrant(tablesDB, databaseId, appwriteUserId)
  if (existing) {
    logger.log(`user ${appwriteUserId} is already provisioned (grant ${existing.$id})`)
    return {
      ok: true,
      created: false,
      accountId: relatedId(existing.account_id) ?? ids.accountId,
      grantId: existing.$id,
      personalAccountId: ids.personalAccountId,
    }
  }

  // 2. Resolve the profile, falling back to what registration stored on the
  //    Auth user so an interrupted registration can be resumed without asking
  //    the person to re-enter anything.
  const profile = input.profile ?? (await recoverProfile(input))
  if (!profile) {
    return {
      ok: false,
      code: 'missing_profile',
      message:
        'No Personal Account profile was supplied and none could be recovered from the account.',
    }
  }

  // 3. Personal Roles are existing data — look the row up, never create it.
  const roleId = await findRoleId(tablesDB, databaseId, profile.role)
  if (!roleId) {
    return {
      ok: false,
      code: 'role_not_found',
      message:
        `The "${profile.role}" row is missing from personal_roles. ` +
        'Run `npm run setup:appwrite` against this project.',
    }
  }

  // 4. Write the records.
  const rows = buildRows({ appwriteUserId, profile, roleId, ids })

  try {
    await writeRows(input, rows)
  } catch (error) {
    // A primary-key conflict means a concurrent request for the same Auth user
    // won the race. That is a success for the caller: exactly one set of
    // records exists, which is the guarantee we are after.
    if (isConflict(error)) {
      logger.log(`concurrent provisioning detected for user ${appwriteUserId}; using the winner`)
      const winner = await waitForGrant(tablesDB, databaseId, appwriteUserId)
      if (winner) {
        return {
          ok: true,
          created: false,
          accountId: relatedId(winner.account_id) ?? ids.accountId,
          grantId: winner.$id,
          personalAccountId: ids.personalAccountId,
        }
      }
    }
    throw error
  }

  logger.log(`provisioned user ${appwriteUserId} -> account ${ids.accountId}`)
  return {
    ok: true,
    created: true,
    accountId: ids.accountId,
    grantId: ids.grantId,
    personalAccountId: ids.personalAccountId,
  }
}

/* -------------------------------------------------------------------------- */
/* Row construction                                                            */
/* -------------------------------------------------------------------------- */

type RowPlan = {
  tableId: string
  rowId: string
  data: Record<string, unknown>
  permissions: string[]
}

function buildRows(args: {
  appwriteUserId: string
  profile: PersonalProfile
  roleId: string
  ids: ReturnType<typeof registrationRowIds>
}): RowPlan[] {
  const { appwriteUserId, profile, roleId, ids } = args

  /**
   * A person may read the records that describe them, and nothing else. No
   * client role is granted create, update or delete anywhere: every write goes
   * through this Function.
   */
  const readableByOwner = [Permission.read(Role.user(appwriteUserId))]

  return [
    {
      tableId: TABLE.accounts,
      rowId: ids.accountId,
      data: {
        account_type: 'individual',
        status: 'active',
        terminated_at: null,
        // `current_access_grant_id` is a plain varchar(36), not a relationship,
        // so it can point at the grant before that row is written. That is what
        // breaks the cycle between `accounts` and `account_access_grants` and
        // lets registration be three inserts with no follow-up update.
        current_access_grant_id: ids.grantId,
      },
      permissions: readableByOwner,
    },
    {
      tableId: TABLE.accountAccessGrants,
      rowId: ids.grantId,
      data: {
        appwrite_user_id: appwriteUserId,
        account_id: ids.accountId,
        revoked_at: null,
      },
      permissions: readableByOwner,
    },
    {
      tableId: TABLE.personalAccounts,
      rowId: ids.personalAccountId,
      data: {
        account_id: ids.accountId,
        role_id: roleId,
        first_name: profile.firstName,
        last_name: profile.lastName,
        contact_phone: profile.contactPhone,
      },
      permissions: readableByOwner,
    },
  ]
}

/* -------------------------------------------------------------------------- */
/* Writing: transaction first, compensation as a fallback                      */
/* -------------------------------------------------------------------------- */

/**
 * `transaction` — require Appwrite's TablesDB transactions.
 * `compensation` — always use explicit undo.
 * `auto` (default) — prefer transactions, fall back once if they are
 *   unavailable on the target Appwrite version.
 */
type Strategy = 'auto' | 'transaction' | 'compensation'

const STRATEGIES = ['auto', 'transaction', 'compensation'] as const

function isStrategy(value: string | undefined): value is Strategy {
  return STRATEGIES.includes(value as Strategy)
}

async function writeRows(input: ProvisionInput, rows: RowPlan[]): Promise<void> {
  const configured = process.env.HAUZ_PROVISIONING_STRATEGY
  const strategy: Strategy = isStrategy(configured) ? configured : 'auto'

  if (strategy === 'compensation') {
    return writeWithCompensation(input, rows)
  }

  try {
    return await writeInTransaction(input, rows)
  } catch (error) {
    if (strategy === 'transaction' || isConflict(error)) throw error
    // The transaction was rolled back, so nothing was persisted and retrying
    // with a different strategy is safe.
    input.logger.error(
      `transactional provisioning failed (${describe(error)}); retrying with compensating writes`,
    )
    return writeWithCompensation(input, rows)
  }
}

/** All three rows commit together, or none of them do. */
async function writeInTransaction(input: ProvisionInput, rows: RowPlan[]): Promise<void> {
  const { tablesDB, databaseId } = input

  const transaction = await tablesDB.createTransaction({
    ttl: TRANSACTION_TTL_SECONDS,
  })

  try {
    for (const row of rows) {
      await tablesDB.createRow({
        databaseId,
        tableId: row.tableId,
        rowId: row.rowId,
        data: row.data,
        permissions: row.permissions,
        transactionId: transaction.$id,
      })
    }
    await tablesDB.updateTransaction({
      transactionId: transaction.$id,
      commit: true,
    })
  } catch (error) {
    await tablesDB
      .updateTransaction({ transactionId: transaction.$id, rollback: true })
      .catch((rollbackError: unknown) => {
        // The transaction expires on its own after `ttl`, so a failed rollback
        // still cannot leak half-written records.
        input.logger.error(
          `rollback of transaction ${transaction.$id} failed: ${describe(rollbackError)}`,
        )
      })
    throw error
  }
}

/**
 * Used when the Appwrite deployment has no transaction support. Every
 * successful write is paired with an undo that runs, in reverse, on failure —
 * so the observable outcome is still all-or-nothing.
 */
async function writeWithCompensation(input: ProvisionInput, rows: RowPlan[]): Promise<void> {
  const { tablesDB, databaseId } = input
  const written: Array<{ tableId: string; rowId: string }> = []

  try {
    for (const row of rows) {
      await tablesDB.createRow({
        databaseId,
        tableId: row.tableId,
        rowId: row.rowId,
        data: row.data,
        permissions: row.permissions,
      })
      written.push({ tableId: row.tableId, rowId: row.rowId })
    }
  } catch (error) {
    await deleteAll(input, written)
    throw error
  }
}

/**
 * Removes rows whose relationships constrain the order they can go in.
 *
 * A fixed order is not enough. Appwrite enforces `restrict` on the many-to-one
 * grant — the account cannot go while a grant points at it — but a one-to-one
 * relationship behaves differently: `personal_accounts` cannot be deleted while
 * its account exists, and deleting the account detaches it instead of blocking.
 * The two rules pull in opposite directions, and which applies depends on the
 * Appwrite version.
 *
 * Rather than encode that, this retries whatever failed until a pass makes no
 * progress. It converges for any ordering the platform imposes, and reports
 * precisely what is left when it cannot.
 */
async function deleteAll(
  input: ProvisionInput,
  targets: Array<{ tableId: string; rowId: string }>,
): Promise<void> {
  const { tablesDB, databaseId, logger } = input
  let remaining = [...targets]

  while (remaining.length > 0) {
    const failed: typeof remaining = []

    for (const target of remaining) {
      try {
        await tablesDB.deleteRow({ databaseId, tableId: target.tableId, rowId: target.rowId })
      } catch {
        failed.push(target)
      }
    }

    // No progress this pass means nothing further will unblock.
    if (failed.length === remaining.length) break
    remaining = failed
  }

  for (const target of remaining) {
    logger.error(
      `MANUAL CLEANUP REQUIRED: ${target.tableId}/${target.rowId} could not be deleted ` +
        'while undoing a failed provisioning.',
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Finds the caller's current access grant.
 *
 * Served by `ix_grants_user_access (appwrite_user_id, revoked_at)`. Ordered by
 * creation time so that, were duplicates ever to exist, the original always
 * wins and the answer stays stable between calls.
 */
async function findActiveGrant(
  tablesDB: TablesDB,
  databaseId: string,
  appwriteUserId: string,
): Promise<AccountAccessGrantRow | null> {
  const result = await tablesDB.listRows<AccountAccessGrantRow>({
    databaseId,
    tableId: TABLE.accountAccessGrants,
    queries: [
      Query.equal('appwrite_user_id', appwriteUserId),
      Query.isNull('revoked_at'),
      Query.orderAsc('$createdAt'),
      Query.limit(1),
    ],
  })

  return result.rows[0] ?? null
}

/**
 * Re-reads the grant after losing a write race. The winner commits at roughly
 * the same moment, so a couple of short retries cover the gap.
 */
async function waitForGrant(
  tablesDB: TablesDB,
  databaseId: string,
  appwriteUserId: string,
): Promise<AccountAccessGrantRow | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const grant = await findActiveGrant(tablesDB, databaseId, appwriteUserId)
    if (grant) return grant
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

/** Resolves a Personal Role id from its immutable `value`. */
async function findRoleId(
  tablesDB: TablesDB,
  databaseId: string,
  value: PersonalProfile['role'],
): Promise<string | null> {
  const result = await tablesDB.listRows<PersonalRoleRow>({
    databaseId,
    tableId: TABLE.personalRoles,
    queries: [Query.equal('value', value), Query.limit(1)],
  })

  return result.rows[0]?.$id ?? null
}

/** Reads the profile registration stored on the Appwrite Auth user. */
async function recoverProfile(input: ProvisionInput): Promise<PersonalProfile | null> {
  try {
    const prefs = await input.users.getPrefs({ userId: input.appwriteUserId })
    return prefsToProfile(prefs)
  } catch (error) {
    input.logger.error(`could not read preferences for ${input.appwriteUserId}: ${describe(error)}`)
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

function isConflict(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 409
}

export function describe(error: unknown): string {
  if (error instanceof AppwriteException) {
    return `${error.code} ${error.type || 'unknown'}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}
