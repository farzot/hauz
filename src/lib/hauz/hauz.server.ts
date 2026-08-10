/**
 * The application's view of the HAUZ tables.
 *
 * Reads and writes take deliberately different paths:
 *
 *   reads  — issued with the signed-in person's own session. Row-level
 *            permissions mean Appwrite returns their records and nothing else,
 *            so authorisation is enforced by the database rather than by a
 *            filter this code could get wrong.
 *   writes — never happen here. They are delegated to the
 *            `hauz-account-provisioning` Appwrite Function, invoked with a
 *            short-lived JWT so the Function can trust who is asking.
 */
import { ExecutionMethod, Query } from 'node-appwrite'

import { TABLE, relatedId } from '../../../shared/hauz-schema'
import type {
  AccountAccessGrantRow,
  AccountRow,
  PersonalAccountRow,
  PersonalProfile,
  PersonalRoleRow,
  ProvisionRequest,
  ProvisionResponse,
  Related,
  RowMeta,
} from '../../../shared/hauz-schema'
import { jwtClient, sessionClient } from '../appwrite/clients.server'
import { describeForLog } from '../appwrite/errors'
import type { HauzProfile } from '../auth/model'
import { env } from '../env.server'

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the HAUZ Account the signed-in person currently has access to, or
 * `null` when registration never produced one.
 *
 * The path follows the schema rather than shortcutting it: the Appwrite Auth
 * user is connected to an Account only through an unrevoked
 * `account_access_grants` row, so that is where the lookup starts.
 */
export async function readHauzProfile(
  sessionSecret: string,
  appwriteUserId: string,
): Promise<HauzProfile | null> {
  const { tablesDB } = sessionClient(sessionSecret)
  const databaseId = env().APPWRITE_DATABASE_ID

  // Served by ix_grants_user_access (appwrite_user_id, revoked_at). The nested
  // select asks Appwrite to return the account itself rather than just its id,
  // which saves a round trip; `resolveRelated` covers deployments that ignore it.
  const grants = await tablesDB.listRows<AccountAccessGrantRow>({
    databaseId,
    tableId: TABLE.accountAccessGrants,
    queries: [
      Query.equal('appwrite_user_id', appwriteUserId),
      Query.isNull('revoked_at'),
      Query.orderAsc('$createdAt'),
      Query.limit(1),
      Query.select(['*', 'account_id.*']),
    ],
  })

  const grant = grants.rows[0]
  if (!grant) return null

  const accountId = relatedId(grant.account_id)
  if (!accountId) return null

  const account = await resolveRelated<AccountRow>(
    tablesDB,
    databaseId,
    TABLE.accounts,
    grant.account_id,
  )
  if (!account) return null

  // Row security already limits this to the caller's own rows; filtering by the
  // account keeps the query honest about what it is asking for.
  const personalAccounts = await tablesDB.listRows<PersonalAccountRow>({
    databaseId,
    tableId: TABLE.personalAccounts,
    queries: [
      Query.equal('account_id', accountId),
      Query.limit(1),
      Query.select(['*', 'role_id.*']),
    ],
  })

  const personalAccount = personalAccounts.rows[0]
  if (!personalAccount) return null

  const role = await resolveRelated<PersonalRoleRow>(
    tablesDB,
    databaseId,
    TABLE.personalRoles,
    personalAccount.role_id,
  )
  if (!role) return null

  return {
    accountId: account.$id,
    accountType: account.account_type,
    accountStatus: account.status,
    terminatedAt: account.terminated_at,
    currentAccessGrantId: account.current_access_grant_id,
    grantId: grant.$id,
    grantedAt: grant.$createdAt,
    personalAccountId: personalAccount.$id,
    firstName: personalAccount.first_name,
    lastName: personalAccount.last_name,
    contactPhone: personalAccount.contact_phone,
    role: role.value,
  }
}

/**
 * Returns the related row, fetching it when the column came back as a bare id.
 *
 * Appwrite only expands a relationship when the query asks it to, and whether a
 * given deployment honours the nested `Query.select` is not something this
 * application should depend on. Handling both shapes costs one conditional and
 * removes an entire class of "works here, silently empty there".
 */
async function resolveRelated<TRow extends RowMeta>(
  tablesDB: ReturnType<typeof sessionClient>['tablesDB'],
  databaseId: string,
  tableId: string,
  value: Related<TRow>,
): Promise<TRow | null> {
  if (!value) return null
  if (typeof value !== 'string') return value
  return tablesDB.getRow<TRow>({ databaseId, tableId, rowId: value })
}

/* -------------------------------------------------------------------------- */
/* Writes (delegated to the Appwrite Function)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Runs `hauz-account-provisioning` on behalf of the signed-in person.
 *
 * The execution is synchronous: registration must not report success before the
 * records actually exist. Identity travels as a JWT rather than as a field in
 * the payload, so the Function reads it from `x-appwrite-user-id` — a value the
 * caller cannot forge.
 *
 * `profile` is omitted when resuming an interrupted registration; the Function
 * then recovers it from the Auth user's preferences.
 */
export async function provisionHauzAccount(
  sessionSecret: string,
  profile?: PersonalProfile,
): Promise<ProvisionResponse> {
  const { account } = sessionClient(sessionSecret)
  const { jwt } = await account.createJWT()

  const { functions } = jwtClient(jwt)
  const execution = await functions.createExecution({
    functionId: env().APPWRITE_PROVISIONING_FUNCTION_ID,
    body: JSON.stringify({ profile } satisfies ProvisionRequest),
    async: false,
    xpath: '/',
    method: ExecutionMethod.POST,
    headers: { 'content-type': 'application/json' },
  })

  if (execution.status === 'failed') {
    console.error(
      `[hauz] provisioning execution ${execution.$id} failed: ${execution.errors || 'no details'}`,
    )
    return {
      ok: false,
      code: 'provisioning_failed',
      message: 'Could not create the HAUZ records for this account.',
    }
  }

  try {
    return JSON.parse(execution.responseBody) as ProvisionResponse
  } catch (error) {
    console.error(
      `[hauz] provisioning execution ${execution.$id} returned an unreadable body ` +
        `(status ${execution.responseStatusCode}): ${describeForLog(error)}`,
    )
    return {
      ok: false,
      code: 'provisioning_failed',
      message: 'Could not create the HAUZ records for this account.',
    }
  }
}
