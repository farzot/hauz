/**
 * Creates the HAUZ schema in an Appwrite project: the database, the four tables
 * and their permissions, every column and index, and the two `personal_roles`
 * rows the assignment treats as existing data.
 *
 *   npm run setup:appwrite
 *
 * Idempotent: run it against an empty project or a half-built one and it
 * converges on the same state. It creates nothing outside the supplied schema.
 * Needs an API key with the databases/tables/columns/indexes/rows scopes listed
 * in .env.example.
 */
import { randomUUID } from 'node:crypto'
import process from 'node:process'

import 'dotenv/config'
import {
  AppwriteException,
  Client,
  Permission,
  Query,
  RelationMutate,
  RelationshipType,
  Role,
  TablesDB,
  TablesDBIndexType,
} from 'node-appwrite'

import { HAUZ_SCHEMA, PERSONAL_ROLE, TABLE } from '../shared/hauz-schema'
import type { ColumnDef, IndexDef, TableDef } from '../shared/hauz-schema'

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`\nMissing required environment variable: ${name}`)
    console.error('Copy .env.example to .env and fill it in before running this script.\n')
    process.exit(1)
  }
  return value
}

const endpoint = requireEnv('APPWRITE_ENDPOINT')
const projectId = requireEnv('APPWRITE_PROJECT_ID')
const apiKey = requireEnv('APPWRITE_API_KEY')
const databaseId = process.env.APPWRITE_DATABASE_ID || 'hauz'
const databaseName = process.env.APPWRITE_DATABASE_NAME || 'HAUZ'

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
const tablesDB = new TablesDB(client)

/* -------------------------------------------------------------------------- */
/* Table permission model                                                      */
/* -------------------------------------------------------------------------- */

/**
 * No table grants write access to any client role; every row is written by the
 * provisioning Function. Reads are user-scoped instead: the three user-owned
 * tables use row security and the Function stamps each row with
 * `read("user:<id>")`, while `personal_roles` is readable by any signed-in user.
 */
const TABLE_PERMISSIONS: Record<string, string[]> = {
  [TABLE.accounts]: [],
  [TABLE.accountAccessGrants]: [],
  [TABLE.personalAccounts]: [],
  [TABLE.personalRoles]: [Permission.read(Role.users())],
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

const created: string[] = []
const skipped: string[] = []
const warnings: string[] = []

function isNotFound(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 404
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 409
}

function describe(error: unknown): string {
  if (error instanceof AppwriteException) {
    return `${error.code} ${error.type || 'unknown'}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function step(message: string) {
  console.log(`  ${message}`)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Appwrite builds columns and indexes asynchronously, and an index over a
 * column still `processing` fails, so every create polls until it is available.
 */
async function waitUntilAvailable(
  label: string,
  read: () => Promise<{ status: string; error?: string }>,
  { attempts = 60, intervalMs = 500 } = {},
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const resource = await read()
    if (resource.status === 'available') return
    if (resource.status === 'failed') {
      throw new Error(`${label} failed to build: ${resource.error || 'no details returned'}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`${label} did not become available within ${(attempts * intervalMs) / 1000}s`)
}

/* -------------------------------------------------------------------------- */
/* 1. Database                                                                 */
/* -------------------------------------------------------------------------- */

async function ensureDatabase(): Promise<void> {
  console.log(`\nDatabase "${databaseId}"`)
  try {
    await tablesDB.get({ databaseId })
    skipped.push(`database ${databaseId}`)
    step('already exists')
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  await tablesDB.create({ databaseId, name: databaseName, enabled: true })
  created.push(`database ${databaseId}`)
  step('created')
}

/* -------------------------------------------------------------------------- */
/* 2. Tables                                                                   */
/* -------------------------------------------------------------------------- */

async function ensureTable(table: TableDef): Promise<void> {
  const permissions = TABLE_PERMISSIONS[table.id] ?? []
  try {
    await tablesDB.getTable({ databaseId, tableId: table.id })
    // Re-applied so a re-run repairs edits made in the console.
    await tablesDB.updateTable({
      databaseId,
      tableId: table.id,
      name: table.name,
      permissions,
      rowSecurity: table.rowSecurity,
      enabled: true,
    })
    skipped.push(`table ${table.id}`)
    step(`table ${table.id}: already exists (permissions re-applied)`)
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  await tablesDB.createTable({
    databaseId,
    tableId: table.id,
    name: table.name,
    permissions,
    rowSecurity: table.rowSecurity,
    enabled: true,
  })
  created.push(`table ${table.id}`)
  step(`table ${table.id}: created`)
}

/* -------------------------------------------------------------------------- */
/* 3. Columns                                                                  */
/* -------------------------------------------------------------------------- */

const RELATIONSHIP_TYPES = {
  oneToOne: RelationshipType.OneToOne,
  manyToOne: RelationshipType.ManyToOne,
} as const

async function createColumn(tableId: string, column: ColumnDef): Promise<void> {
  switch (column.kind) {
    case 'string':
      // The schema specifies varchar(20/36/100) and this is the API that takes
      // a size; createTextColumn has none.
      await tablesDB.createVarcharColumn({
        databaseId,
        tableId,
        key: column.key,
        size: column.size,
        required: column.required,
      })
      return
    case 'enum':
      await tablesDB.createEnumColumn({
        databaseId,
        tableId,
        key: column.key,
        elements: [...column.elements],
        required: column.required,
      })
      return
    case 'datetime':
      await tablesDB.createDatetimeColumn({
        databaseId,
        tableId,
        key: column.key,
        required: column.required,
      })
      return
    case 'relationship':
      await tablesDB.createRelationshipColumn({
        databaseId,
        tableId,
        relatedTableId: column.relatedTable,
        type: RELATIONSHIP_TYPES[column.type],
        twoWay: column.twoWay,
        key: column.key,
        onDelete: RelationMutate.Restrict,
      })
      return
  }
}

async function ensureColumn(table: TableDef, column: ColumnDef): Promise<void> {
  try {
    await tablesDB.getColumn({ databaseId, tableId: table.id, key: column.key })
    skipped.push(`column ${table.id}.${column.key}`)
    step(`column ${table.id}.${column.key}: already exists`)
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  try {
    await createColumn(table.id, column)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
  }

  await waitUntilAvailable(`column ${table.id}.${column.key}`, async () => {
    const column_ = (await tablesDB.getColumn({
      databaseId,
      tableId: table.id,
      key: column.key,
    })) as { status: string; error?: string }
    return column_
  })

  created.push(`column ${table.id}.${column.key}`)
  step(`column ${table.id}.${column.key}: created`)
}

/* -------------------------------------------------------------------------- */
/* 4. Indexes                                                                  */
/* -------------------------------------------------------------------------- */

const INDEX_TYPES = {
  key: TablesDBIndexType.Key,
  unique: TablesDBIndexType.Unique,
} as const

async function ensureIndex(table: TableDef, index: IndexDef): Promise<void> {
  try {
    await tablesDB.getIndex({ databaseId, tableId: table.id, key: index.key })
    skipped.push(`index ${table.id}.${index.key}`)
    step(`index ${table.id}.${index.key}: already exists`)
    return
  } catch (error) {
    if (!isNotFound(error)) throw error
  }

  try {
    await tablesDB.createIndex({
      databaseId,
      tableId: table.id,
      key: index.key,
      type: INDEX_TYPES[index.type],
      columns: [...index.columns],
    })

    await waitUntilAvailable(`index ${table.id}.${index.key}`, async () => {
      const index_ = (await tablesDB.getIndex({
        databaseId,
        tableId: table.id,
        key: index.key,
      })) as { status: string; error?: string }
      return index_
    })

    created.push(`index ${table.id}.${index.key}`)
    step(`index ${table.id}.${index.key}: created`)
  } catch (error) {
    // Some Appwrite versions refuse to index relationship columns. The index is
    // part of the supplied schema, so it is always attempted; a rejection is
    // reported at the end rather than silently dropped.
    const usesRelationship = index.columns.some((columnKey) =>
      table.columns.some((column) => column.key === columnKey && column.kind === 'relationship'),
    )
    if (!usesRelationship) throw error

    warnings.push(
      `index ${table.id}.${index.key} could not be created (${describe(error)}). ` +
        'It indexes a relationship column, which this Appwrite version does not support.',
    )
    step(`index ${table.id}.${index.key}: SKIPPED — see warnings`)
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Seed data                                                                */
/* -------------------------------------------------------------------------- */

async function seedPersonalRoles(): Promise<void> {
  console.log('\nSeeding personal_roles')
  for (const value of PERSONAL_ROLE) {
    const existing = await tablesDB.listRows({
      databaseId,
      tableId: TABLE.personalRoles,
      queries: [Query.equal('value', value), Query.limit(1)],
    })

    const existingRow = existing.rows[0]
    if (existingRow) {
      skipped.push(`personal_roles.${value}`)
      step(`${value}: already exists (${existingRow.$id})`)
      continue
    }

    // The assignment requires a generated UUID for every HAUZ row id.
    const row = await tablesDB.createRow({
      databaseId,
      tableId: TABLE.personalRoles,
      rowId: randomUUID(),
      data: { value },
    })
    created.push(`personal_roles.${value}`)
    step(`${value}: created (${row.$id})`)
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log('HAUZ Appwrite setup')
  console.log(`  endpoint : ${endpoint}`)
  console.log(`  project  : ${projectId}`)
  console.log(`  database : ${databaseId}`)

  await ensureDatabase()

  for (const table of HAUZ_SCHEMA) {
    console.log(`\nTable "${table.id}"`)
    await ensureTable(table)
    for (const column of table.columns) {
      await ensureColumn(table, column)
    }
  }

  // Second pass, so every column exists before an index references it.
  for (const table of HAUZ_SCHEMA) {
    if (table.indexes.length === 0) continue
    console.log(`\nIndexes for "${table.id}"`)
    for (const index of table.indexes) {
      await ensureIndex(table, index)
    }
  }

  await seedPersonalRoles()

  console.log('\n─────────────────────────────────────────')
  console.log(`Created: ${created.length}   Already present: ${skipped.length}`)
  if (warnings.length > 0) {
    console.log(`\n${warnings.length} warning(s):`)
    for (const warning of warnings) console.log(`  ! ${warning}`)
  }
  console.log('\nSchema is ready.')
  console.log('Next: deploy the Appwrite Function (see README.md).\n')
}

main().catch((error) => {
  console.error('\nSetup failed:', describe(error))
  if (error instanceof Error && error.stack) {
    console.error(error.stack.split('\n').slice(1, 4).join('\n'))
  }
  process.exit(1)
})
