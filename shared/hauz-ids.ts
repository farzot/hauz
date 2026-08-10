/**
 * Row-id generation for HAUZ records.
 *
 * The assignment requires a generated UUID for every HAUZ row `$id`. This module
 * generates RFC 4122 version 5 UUIDs — name-based, SHA-1 — for the three rows
 * that registration creates, deriving them from the Appwrite Auth user id.
 *
 * Why not a random UUID?
 *   Registration writes three related rows. Two concurrent registration requests
 *   for the same Auth user (a double-submitted form, a retried request, a client
 *   that reconnects) would otherwise each write their own set and leave the
 *   person with duplicate HAUZ Accounts. A deterministic id turns that race into
 *   a primary-key conflict that Appwrite rejects, so at most one set of records
 *   can ever exist. The requirement "do not leave partial or duplicate HAUZ
 *   records" then holds under concurrency, not just in the happy path.
 *
 * Scope: only the records created by Personal Account registration are derived
 * this way. Any later row — a re-issued grant after a revocation, an Agency
 * Member Account — is outside this task and would use a random UUID, so the
 * history that `account_access_grants` is designed to keep is unaffected.
 *
 * The ids are unguessable only to the extent the Auth user id is; access is
 * enforced by row permissions, never by id secrecy.
 *
 * Server-only: this module uses `node:crypto` and must not reach the browser
 * bundle. Browser-safe schema values live in `hauz-schema.ts`.
 */
import { createHash } from 'node:crypto'

/**
 * Fixed namespace for HAUZ-derived identifiers. A constant of the application,
 * not project configuration: changing it would change every derived id.
 */
const HAUZ_NAMESPACE = '3f2b6d84-9a55-4c1e-8b7d-2e6a0f4c91d3'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** RFC 4122 §4.3 — name-based UUID using SHA-1. */
export function uuidV5(name: string, namespace: string = HAUZ_NAMESPACE): string {
  if (!UUID_PATTERN.test(namespace)) {
    throw new Error(`uuidV5: namespace must be a UUID, received "${namespace}"`)
  }

  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest()

  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6) // version 5
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8) // RFC 4122 variant

  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * The three row ids that Personal Account registration produces for one
 * Appwrite Auth user. Same input, same ids — on every call, from every process.
 */
export function registrationRowIds(appwriteUserId: string): {
  accountId: string
  grantId: string
  personalAccountId: string
} {
  return {
    accountId: uuidV5(`hauz:accounts:registration:${appwriteUserId}`),
    grantId: uuidV5(`hauz:account_access_grants:registration:${appwriteUserId}`),
    personalAccountId: uuidV5(`hauz:personal_accounts:registration:${appwriteUserId}`),
  }
}
