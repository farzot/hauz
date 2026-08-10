// Reads use the signed-in person's own session, so row permissions decide what
// comes back and a filter here cannot get it wrong. Writes never happen here at
// all: they go to the hauz-account-provisioning Function.
import { ExecutionMethod, Query } from 'node-appwrite'

import { TABLE, relatedId } from '../../shared/hauz-schema'
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
} from '../../shared/hauz-schema'
import { jwtClient, sessionClient } from './appwrite/clients.server'
import { describeForLog } from './appwrite/errors.server'
import type { HauzProfile } from '../shared/auth-model'
import { env } from './env.server'

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The Account this person has access to, or `null` if registration never made
 * one. The lookup starts at `account_access_grants` because that is the only
 * thing connecting an Auth user to an Account.
 */
export async function readHauzProfile(
  sessionSecret: string,
  appwriteUserId: string,
): Promise<HauzProfile | null> {
  const { tablesDB } = sessionClient(sessionSecret)
  const databaseId = env().APPWRITE_DATABASE_ID

  // Served by ix_grants_user_access. The nested select asks for the account
  // itself, not just its id, which saves a round trip where it is honoured.
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

  // Row security already limits this to the caller's own rows; the filter keeps
  // the query honest about what it is asking for.
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
 * Appwrite returns a relationship as a bare id unless the query asks for
 * expansion, and not every deployment honours the nested select. Handling both
 * shapes costs one conditional and avoids "works here, empty there".
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
 * Runs the provisioning Function as the signed-in person. Synchronous, because
 * registration must not report success before the rows exist. Identity travels
 * as a JWT, not as a field in the payload, so the Function can trust it.
 *
 * Omit `profile` to resume an interrupted registration; the Function then reads
 * it from the Auth user's preferences.
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
    // Appwrite only fills in execution.errors/logs for API-key callers, not for
    // a user JWT, so the status code is all we get here. The rest is in the
    // function's own log.
    console.error(
      `[hauz] provisioning execution ${execution.$id} failed ` +
        `(status ${execution.responseStatusCode}); see the function log in the Appwrite console`,
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
