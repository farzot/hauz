/**
 * Asserts that `shared/hauz-schema.ts` still describes the schema the
 * assignment supplied — no table, column, index or allowed value added,
 * removed or renamed.
 *
 *   npm run check:schema
 *
 * The expectation below is transcribed from the brief and the ERD by hand and
 * is deliberately independent of the declaration it checks, so an accidental
 * edit to the schema fails the build rather than reaching a reviewer.
 */
import process from 'node:process'

import { ACCOUNT_STATUS, ACCOUNT_TYPE, HAUZ_SCHEMA, PERSONAL_ROLE } from '../shared/hauz-schema'

type TableExpectation = { columns: string[]; indexes: string[] }

/**
 * As printed in docs/hauz-backend-interview-task.pdf, pages 3–4.
 *
 * Typed as a plain record rather than inferred from the literal, so that a
 * table added to the declaration is reported by this check instead of being
 * silently accepted as an exact key.
 */
const EXPECTED: Record<string, TableExpectation> = {
  accounts: {
    columns: ['account_type', 'status', 'terminated_at', 'current_access_grant_id'],
    indexes: ['ix_accounts_type_status', 'ix_accounts_terminated'],
  },
  account_access_grants: {
    columns: ['appwrite_user_id', 'account_id', 'revoked_at'],
    indexes: ['ix_grants_user_access', 'ix_grants_account_history', 'ix_grants_user_account'],
  },
  personal_accounts: {
    columns: ['account_id', 'role_id', 'first_name', 'last_name', 'contact_phone'],
    indexes: ['uq_personal_account', 'ix_personal_role', 'ix_personal_contact_phone'],
  },
  personal_roles: {
    columns: ['value'],
    indexes: ['uq_personal_roles_value'],
  },
}

const problems: string[] = []

function compare(what: string, actual: readonly string[], expected: readonly string[]) {
  const missing = expected.filter((name) => !actual.includes(name))
  const extra = actual.filter((name) => !expected.includes(name))
  if (missing.length) problems.push(`${what}: missing ${missing.join(', ')}`)
  if (extra.length) problems.push(`${what}: unexpected ${extra.join(', ')}`)
}

compare(
  'tables',
  HAUZ_SCHEMA.map((table) => table.id),
  Object.keys(EXPECTED),
)

for (const table of HAUZ_SCHEMA) {
  const expected = EXPECTED[table.id]
  if (!expected) continue
  compare(
    `${table.id} columns`,
    table.columns.map((column) => column.key),
    expected.columns,
  )
  compare(
    `${table.id} indexes`,
    table.indexes.map((index) => index.key),
    expected.indexes,
  )
}

compare('accounts.account_type values', ACCOUNT_TYPE, ['individual'])
compare('accounts.status values', ACCOUNT_STATUS, ['active', 'blocked'])
compare('personal_roles.value values', PERSONAL_ROLE, ['consumer', 'realtor'])

if (problems.length > 0) {
  console.error('\nThe declared schema no longer matches the assignment:\n')
  for (const problem of problems) console.error(`  ! ${problem}`)
  console.error('')
  process.exit(1)
}

const columnCount = HAUZ_SCHEMA.reduce((total, table) => total + table.columns.length, 0)
const indexCount = HAUZ_SCHEMA.reduce((total, table) => total + table.indexes.length, 0)
console.log(
  `Schema matches the assignment: ${HAUZ_SCHEMA.length} tables, ` +
    `${columnCount} columns, ${indexCount} indexes.`,
)
