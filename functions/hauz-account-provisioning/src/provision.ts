// The only code in the system that writes to the HAUZ tables. It runs inside an
// Appwrite Function so that nothing else, browser or web app, ever holds
// credentials able to create an account, issue a grant or set a status.
import { AppwriteException, Permission, Query, Role } from 'node-appwrite'
import type { TablesDB, Users } from 'node-appwrite'

import { registrationRowIds } from './shared/hauz-ids.js'
import { TABLE, prefsToProfile, relatedId } from './shared/hauz-schema.js'
import type {
  AccountAccessGrantRow,
  PersonalAccountRow,
  PersonalProfile,
  PersonalRoleRow,
  ProvisionResponse,
  ProvisionResult,
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

/** Long enough for three writes, short enough to expire cheaply. */
const TRANSACTION_TTL_SECONDS = 60

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function provisionPersonalAccount(input: ProvisionInput): Promise<ProvisionResponse> {
  const { tablesDB, databaseId, appwriteUserId, logger } = input
  const ids = registrationRowIds(appwriteUserId)

  // 1. "Provisioned" has to mean the same thing here as it does to the app
  //    reading these tables back, or the two disagree forever: this reports
  //    success while the app still sees an unfinished registration.
  const existing = await readExisting(tablesDB, databaseId, appwriteUserId)
  const alreadyDone = completedFrom(existing, ids)
  if (alreadyDone) {
    logger.log(`user ${appwriteUserId} is already provisioned (grant ${alreadyDone.grantId})`)
    return alreadyDone
  }

  // A grant with no profile behind it is a half-finished earlier run, the one
  // thing the compensating cleanup can leave when it cannot delete what it
  // wrote. Row ids are derived from the user id, so the rows this run would
  // write are exactly the missing ones and the write below fills the gap.
  const repairing = existing.grant !== null
  if (repairing && existing.grant!.$id !== ids.grantId) {
    logger.error(
      `user ${appwriteUserId}: active grant ${existing.grant!.$id} was not created by this ` +
        'function and has no personal_accounts row behind it',
    )
    return {
      ok: false,
      code: 'provisioning_failed',
      message:
        'This account has an access grant with no Personal Account behind it. ' +
        'It was not created here, so it has to be resolved by hand.',
    }
  }
  if (repairing) {
    logger.error(
      `user ${appwriteUserId}: grant ${existing.grant!.$id} has no personal_accounts row; ` +
        'completing the records an earlier run left unfinished',
    )
  }

  // 2. Fall back to what registration stored on the Auth user, so an
  //    interrupted run resumes without asking for anything again.
  const profile = input.profile ?? (await recoverProfile(input))
  if (!profile) {
    return {
      ok: false,
      code: 'missing_profile',
      message:
        'No Personal Account profile was supplied and none could be recovered from the account.',
    }
  }

  // 3. Personal Roles are existing data: look the row up, never create it.
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
    await (repairing ? fillMissingRows(input, rows) : writeRows(input, rows))
  } catch (error) {
    // A primary-key conflict means a concurrent request won the race, which is
    // a success for the caller: exactly one set of records exists.
    if (isConflict(error)) {
      logger.log(`concurrent provisioning detected for user ${appwriteUserId}; using the winner`)
      const winner = await waitForCompletion(tablesDB, databaseId, appwriteUserId, ids)
      if (winner) return winner

      // Nothing raced us and the rows are already there, so the grant to that
      // Account was revoked. Writing a fresh one would undo an operator's
      // decision, so report the state instead of looping on it forever.
      if (await hasRevokedGrant(tablesDB, databaseId, appwriteUserId)) {
        logger.log(`user ${appwriteUserId} has only revoked grants; refusing to re-grant access`)
        return {
          ok: false,
          code: 'access_revoked',
          message: 'Access to this HAUZ Account has been revoked.',
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

  // A person may read the records that describe them and nothing else. No
  // client role gets create, update or delete anywhere.
  const readableByOwner = [Permission.read(Role.user(appwriteUserId))]

  return [
    {
      tableId: TABLE.accounts,
      rowId: ids.accountId,
      data: {
        account_type: 'individual',
        status: 'active',
        terminated_at: null,
        // A plain varchar(36), not a relationship, so it can point at the grant
        // before that row exists. That breaks the cycle between the two tables
        // and makes registration three inserts with no follow-up update.
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
 * `auto` (default) prefers transactions and falls back once if the target
 * Appwrite version has none; `transaction` and `compensation` pin one.
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
    // Rolled back, so nothing was persisted and retrying is safe.
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
        // The transaction expires after its ttl anyway, so a failed rollback
        // still cannot leak half-written rows.
        input.logger.error(
          `rollback of transaction ${transaction.$id} failed: ${describe(rollbackError)}`,
        )
      })
    throw error
  }
}

/**
 * Fills in whichever rows are missing, treating a conflict as already done.
 *
 * Only reached when an earlier run left a grant without its profile. A
 * transaction is the wrong tool: there is nothing to roll back to, since the
 * half-written state already exists. Every id is derived, so a row that is
 * there is the row this would have written. Failing part-way leaves the same
 * recoverable state it started from.
 */
async function fillMissingRows(input: ProvisionInput, rows: RowPlan[]): Promise<void> {
  const { tablesDB, databaseId, logger } = input

  for (const row of rows) {
    try {
      await tablesDB.createRow({
        databaseId,
        tableId: row.tableId,
        rowId: row.rowId,
        data: row.data,
        permissions: row.permissions,
      })
      logger.log(`repaired missing row ${row.tableId}/${row.rowId}`)
    } catch (error) {
      if (!isConflict(error)) throw error
    }
  }
}

/**
 * For deployments without transaction support. Every successful write is
 * remembered and a failure undoes all of them, so the outcome is still
 * all-or-nothing. `deleteAll` picks the order, because the platform decides
 * which row can go first.
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
 * A fixed delete order is not enough. Appwrite enforces `restrict` on the
 * many-to-one grant, so the account cannot go while a grant points at it; but
 * one-to-one behaves the other way round, and `personal_accounts` cannot go
 * while its account exists. The two rules pull in opposite directions and which
 * applies depends on the version, so this retries until a pass makes no
 * progress and reports whatever is left.
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

    // No progress means nothing further will unblock.
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
 * Served by ix_grants_user_access. Ordered by creation time so that if
 * duplicates ever existed the original wins and the answer stays stable.
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

/** Same index as the active-grant lookup, read from the other end. */
async function hasRevokedGrant(
  tablesDB: TablesDB,
  databaseId: string,
  appwriteUserId: string,
): Promise<boolean> {
  const result = await tablesDB.listRows<AccountAccessGrantRow>({
    databaseId,
    tableId: TABLE.accountAccessGrants,
    queries: [
      Query.equal('appwrite_user_id', appwriteUserId),
      Query.isNotNull('revoked_at'),
      Query.limit(1),
    ],
  })

  return result.rows.length > 0
}

/** The row that completes an Account. */
async function findPersonalAccount(
  tablesDB: TablesDB,
  databaseId: string,
  accountId: string,
): Promise<PersonalAccountRow | null> {
  const result = await tablesDB.listRows<PersonalAccountRow>({
    databaseId,
    tableId: TABLE.personalAccounts,
    queries: [Query.equal('account_id', accountId), Query.limit(1)],
  })

  return result.rows[0] ?? null
}

type ExistingRecords = {
  grant: AccountAccessGrantRow | null
  accountId: string | null
  personalAccount: PersonalAccountRow | null
}

/** What this user already has: the grant, and the profile it leads to. */
async function readExisting(
  tablesDB: TablesDB,
  databaseId: string,
  appwriteUserId: string,
): Promise<ExistingRecords> {
  const grant = await findActiveGrant(tablesDB, databaseId, appwriteUserId)
  const accountId = grant ? relatedId(grant.account_id) : null
  const personalAccount = accountId
    ? await findPersonalAccount(tablesDB, databaseId, accountId)
    : null

  return { grant, accountId, personalAccount }
}

/** The response for an existing set of rows, or `null` if incomplete. */
function completedFrom(
  existing: ExistingRecords,
  ids: ReturnType<typeof registrationRowIds>,
): ProvisionResult | null {
  if (!existing.grant || !existing.personalAccount) return null

  return {
    ok: true,
    created: false,
    accountId: existing.accountId ?? ids.accountId,
    grantId: existing.grant.$id,
    personalAccountId: existing.personalAccount.$id,
  }
}

/** The winner commits at roughly the same moment, so short retries cover it. */
async function waitForCompletion(
  tablesDB: TablesDB,
  databaseId: string,
  appwriteUserId: string,
  ids: ReturnType<typeof registrationRowIds>,
): Promise<ProvisionResult | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const done = completedFrom(await readExisting(tablesDB, databaseId, appwriteUserId), ids)
    if (done) return done
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

/** The profile registration stored on the Auth user. */
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
