/**
 * Checks that `.env` points at a usable Appwrite project. Read-only: it creates
 * and changes nothing.
 *
 *   npm run preflight
 *
 * Run it before setup:appwrite to separate a configuration problem from a
 * provisioning one, and after deploying the function to confirm the pieces can
 * see each other.
 */
import process from 'node:process'

import 'dotenv/config'
import {
  AppwriteException,
  Client,
  Databases,
  Functions,
  Query,
  TablesDB,
  Users,
} from 'node-appwrite'

import { HAUZ_SCHEMA, PERSONAL_ROLE, TABLE } from '../shared/hauz-schema'

/* -------------------------------------------------------------------------- */

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']
const missing = REQUIRED.filter((name) => !process.env[name])

if (missing.length > 0) {
  console.error(`\nMissing from .env: ${missing.join(', ')}`)
  console.error('Copy .env.example to .env and fill it in.\n')
  process.exit(1)
}

const endpoint = process.env.APPWRITE_ENDPOINT!
const projectId = process.env.APPWRITE_PROJECT_ID!
const apiKey = process.env.APPWRITE_API_KEY!
const databaseId = process.env.APPWRITE_DATABASE_ID || 'hauz'
const functionId = process.env.APPWRITE_PROVISIONING_FUNCTION_ID || 'hauz-account-provisioning'

/** Enough to recognise the key, never enough to use it. */
const maskedKey = `${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)`

console.log('\nConfiguration')
console.log(`  endpoint : ${endpoint}`)
console.log(`  project  : ${projectId}`)
console.log(`  api key  : ${maskedKey}`)
console.log(`  database : ${databaseId}`)
console.log(`  function : ${functionId}`)

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
const tablesDB = new TablesDB(client)

let failures = 0
let warnings = 0

function describe(error: unknown): string {
  if (error instanceof AppwriteException) {
    return `${error.code} ${error.type || 'unknown'}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

async function check(label: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ✓ ${label} — ${await run()}`)
  } catch (error) {
    failures += 1
    console.log(`  ✗ ${label} — ${describe(error)}`)
  }
}

/** Something a later setup step is expected to create. */
async function checkOptional(label: string, run: () => Promise<string>, hint: string) {
  try {
    console.log(`  ✓ ${label} — ${await run()}`)
  } catch (error) {
    warnings += 1
    console.log(`  · ${label} — not there yet (${describe(error)})`)
    console.log(`      → ${hint}`)
  }
}

/* -------------------------------------------------------------------------- */

console.log('\nConnection and credentials')

await check('endpoint, project id and API key', async () => {
  const databases = await new Databases(client).list({ queries: [Query.limit(1)] })
  return `reachable, ${databases.total} database(s) visible`
})

await check('scope users.read', async () => {
  const users = await new Users(client).list({ queries: [Query.limit(1)] })
  return `${users.total} Auth user(s) registered`
})

console.log('\nSchema')

let schemaReady = true

await checkOptional(
  `database "${databaseId}"`,
  async () => `exists — "${(await tablesDB.get({ databaseId })).name}"`,
  'run `npm run setup:appwrite`',
)

for (const table of HAUZ_SCHEMA) {
  try {
    const found = await tablesDB.getTable({ databaseId, tableId: table.id })
    const columns = await tablesDB.listColumns({ databaseId, tableId: table.id })
    const indexes = await tablesDB.listIndexes({ databaseId, tableId: table.id })

    // Indexes on relationship columns are a platform limitation, not missing
    // work, so they are counted separately.
    const relationshipColumns = new Set(
      table.columns.filter((column) => column.kind === 'relationship').map((column) => column.key),
    )
    const supportedIndexes = table.indexes.filter(
      (index) => !index.columns.some((column) => relationshipColumns.has(column)),
    )
    const unsupported = table.indexes.length - supportedIndexes.length

    const complete =
      columns.total >= table.columns.length && indexes.total >= supportedIndexes.length
    const rowSecurityCorrect = found.rowSecurity === table.rowSecurity

    if (!complete) warnings += 1
    console.log(
      `  ${complete && rowSecurityCorrect ? '✓' : '·'} table "${table.id}" — ` +
        `${columns.total}/${table.columns.length} columns, ` +
        `${indexes.total}/${supportedIndexes.length} indexes` +
        (unsupported > 0 ? ` (+${unsupported} unsupported by Appwrite)` : '') +
        `, row security ${found.rowSecurity ? 'on' : 'off'}`,
    )

    if (!rowSecurityCorrect) {
      warnings += 1
      console.log(
        `      → row security should be ${table.rowSecurity ? 'on' : 'off'} for this table; ` +
          're-run `npm run setup:appwrite`',
      )
    }
  } catch {
    schemaReady = false
    warnings += 1
    console.log(`  · table "${table.id}" — not there yet`)
    console.log('      → run `npm run setup:appwrite`')
  }
}

if (schemaReady) {
  await checkOptional(
    'personal_roles seeded',
    async () => {
      const rows = await tablesDB.listRows({
        databaseId,
        tableId: TABLE.personalRoles,
        queries: [Query.limit(10)],
      })
      const values = rows.rows.map((row) => String(row.value)).sort()
      const expected = [...PERSONAL_ROLE].sort()
      if (values.join() !== expected.join()) {
        throw new Error(`expected ${expected.join(', ')} but found ${values.join(', ') || 'none'}`)
      }
      return values.join(', ')
    },
    'run `npm run setup:appwrite`',
  )
}

console.log('\nAppwrite Function')

const functions = new Functions(client)

await checkOptional(
  `function "${functionId}"`,
  async () => {
    const fn = await functions.get({ functionId })
    const canExecute = fn.execute.includes('users') || fn.execute.includes('any')
    if (!canExecute) {
      throw new Error(`execute access is ${JSON.stringify(fn.execute)}, needs "users"`)
    }
    return `runtime ${fn.runtime}, execute ${JSON.stringify(fn.execute)}`
  },
  'deploy it with `npm run deploy:function` (see README). A 401 above means the ' +
    'function may well be deployed and the API key is simply missing functions.read',
)

// The function falls back to a database called `hauz`, so with any other name
// a forgotten variable shows up as "table not found" at registration time.
if (databaseId !== 'hauz') {
  await checkOptional(
    'function variable APPWRITE_DATABASE_ID',
    async () => {
      const variables = await functions.listVariables({ functionId })
      const variable = variables.variables.find((item) => item.key === 'APPWRITE_DATABASE_ID')
      if (!variable) {
        throw new Error(`not set, so the function would look for a database called "hauz"`)
      }
      return 'set'
    },
    'npx appwrite functions create-variable --function-id ' +
      `${functionId} --variable-id dbid --key APPWRITE_DATABASE_ID --value ${databaseId}`,
  )
}

console.log('\nEmail verification')

const transport =
  process.env.EMAIL_TRANSPORT || (process.env.RESEND_API_KEY ? 'resend' : 'appwrite')

if (transport === 'appwrite') {
  console.log('  · transport "appwrite" — Appwrite sends the verification email over the')
  console.log("      project SMTP. On Appwrite Cloud's free plan the shared sender is")
  console.log('      rate-limited and often filtered; set RESEND_API_KEY to use Resend.')
} else {
  const from = process.env.EMAIL_FROM
  if (!process.env.RESEND_API_KEY || !from) {
    failures += 1
    console.log('  ✗ transport "resend" — RESEND_API_KEY and EMAIL_FROM must both be set')
  } else {
    console.log(`  ✓ transport "resend" — sending as ${from}`)

    await check('Resend API key', async () => {
      const response = await fetch('https://api.resend.com/domains', {
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      if (response.status === 401 || response.status === 403) {
        throw new Error('rejected by Resend — check the key and its permissions')
      }
      if (!response.ok) throw new Error(`Resend returned ${response.status}`)

      const body = (await response.json()) as { data?: Array<{ name: string; status: string }> }
      const verified = (body.data ?? []).filter((domain) => domain.status === 'verified')
      if (verified.length > 0) {
        return `accepted, verified domain(s): ${verified.map((d) => d.name).join(', ')}`
      }
      return 'accepted, no verified domain — delivery is limited to your own Resend address'
    })
  }
}

/* -------------------------------------------------------------------------- */

console.log('\n─────────────────────────────────────────')

if (failures > 0) {
  console.log(`${failures} problem(s) with the connection or credentials. Fix .env first.\n`)
  process.exit(1)
}

if (warnings > 0) {
  console.log(`Credentials work. ${warnings} setup step(s) still pending — see the arrows above.\n`)
  process.exit(0)
}

console.log('Everything is in place. Run `npm run dev`.\n')
