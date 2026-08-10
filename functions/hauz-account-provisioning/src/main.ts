/**
 * `hauz-account-provisioning` — Appwrite Function.
 *
 * Creates the HAUZ records for a registered person: one `individual` account,
 * the `account_access_grants` row that connects it to their Appwrite Auth user,
 * and their `personal_accounts` profile.
 *
 * Invocation
 *   POST, executed with the caller's JWT. Appwrite derives `x-appwrite-user-id`
 *   from that JWT, which is the only source of identity this Function trusts —
 *   a user id in the request body is ignored.
 *
 * Body (optional)
 *   { "profile": { firstName, lastName, role, contactPhone } }
 *   Omit it to re-run provisioning for an account whose registration did not
 *   finish; the profile is then recovered from the Auth user's preferences.
 *
 * Credentials
 *   The dynamic API key in `x-appwrite-key`. Nothing is hard-coded, and the key
 *   is scoped in the Appwrite console rather than stored anywhere.
 *
 * Idempotent: calling it repeatedly for the same user creates one set of
 * records and then reports `created: false`.
 */
import { Client, TablesDB, Users } from 'node-appwrite'

import { describe, provisionPersonalAccount } from './provision.js'
import { provisionRequestSchema } from './shared/hauz-schema.js'
import type { ProvisionResponse } from './shared/hauz-schema.js'

/* -------------------------------------------------------------------------- */
/* Appwrite runtime context                                                    */
/* -------------------------------------------------------------------------- */

type AppwriteRequest = {
  method: string
  headers: Record<string, string>
  bodyJson?: unknown
  bodyRaw?: string
  bodyText?: string
}

type AppwriteResponse = {
  json: (data: unknown, statusCode?: number) => unknown
}

type AppwriteContext = {
  req: AppwriteRequest
  res: AppwriteResponse
  log: (message: unknown) => void
  error: (message: unknown) => void
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const STATUS_BY_CODE: Record<Extract<ProvisionResponse, { ok: false }>['code'], number> = {
  unauthenticated: 401,
  invalid_request: 400,
  missing_profile: 422,
  role_not_found: 500,
  provisioning_failed: 500,
}

function requireEnv(name: string, ...fallbacks: string[]): string {
  for (const candidate of [name, ...fallbacks]) {
    const value = process.env[candidate]
    if (value) return value
  }
  throw new Error(`Missing environment variable: ${name}`)
}

function readBody(req: AppwriteRequest): unknown {
  if (req.bodyJson !== undefined && req.bodyJson !== null && req.bodyJson !== '') {
    return req.bodyJson
  }
  const raw = req.bodyRaw ?? req.bodyText
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

export default async function handler({ req, res, log, error }: AppwriteContext) {
  if (req.method !== 'POST') {
    return res.json({ ok: false, code: 'invalid_request', message: 'Use POST.' }, 405)
  }

  // Identity comes from the JWT Appwrite validated, never from the payload.
  const appwriteUserId = req.headers['x-appwrite-user-id']
  if (!appwriteUserId) {
    return res.json(
      {
        ok: false,
        code: 'unauthenticated',
        message: 'This function must be executed with an authenticated user JWT.',
      } satisfies ProvisionResponse,
      401,
    )
  }

  const body = readBody(req)
  if (body === undefined) {
    return res.json(
      {
        ok: false,
        code: 'invalid_request',
        message: 'Request body is not valid JSON.',
      } satisfies ProvisionResponse,
      400,
    )
  }

  const parsed = provisionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return res.json(
      {
        ok: false,
        code: 'invalid_request',
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      } satisfies ProvisionResponse,
      400,
    )
  }

  try {
    const apiKey = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY
    if (!apiKey) {
      throw new Error(
        'No API key available. Enable the dynamic API key for this function, or set APPWRITE_API_KEY.',
      )
    }

    const client = new Client()
      .setEndpoint(requireEnv('APPWRITE_FUNCTION_API_ENDPOINT', 'APPWRITE_ENDPOINT'))
      .setProject(requireEnv('APPWRITE_FUNCTION_PROJECT_ID', 'APPWRITE_PROJECT_ID'))
      .setKey(apiKey)

    const result = await provisionPersonalAccount({
      tablesDB: new TablesDB(client),
      users: new Users(client),
      databaseId: process.env.APPWRITE_DATABASE_ID || 'hauz',
      appwriteUserId,
      profile: parsed.data.profile,
      logger: {
        log: (message) => log(message),
        error: (message) => error(message),
      },
    })

    return res.json(result, result.ok ? 200 : STATUS_BY_CODE[result.code])
  } catch (thrown) {
    // Details go to the function log; the caller gets a stable, non-leaking shape.
    error(`provisioning failed for ${appwriteUserId}: ${describe(thrown)}`)
    return res.json(
      {
        ok: false,
        code: 'provisioning_failed',
        message: 'Could not create the HAUZ records for this account.',
      } satisfies ProvisionResponse,
      500,
    )
  }
}
