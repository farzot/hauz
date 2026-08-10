/* eslint-disable */
// -----------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from shared/hauz-ids.ts by scripts/sync-shared.ts.
// Edit the original and run `npm run sync:shared`.
// -----------------------------------------------------------------------------
/**
 * Generated UUIDs for the three rows registration creates, derived from the
 * Appwrite Auth user id instead of random.
 *
 * Random ids would let two concurrent registrations for the same user each
 * write their own set of rows. Deriving them turns that race into a primary-key
 * conflict Appwrite rejects, so at most one set can exist and "no duplicate
 * HAUZ records" holds under concurrency, not just in the happy path.
 *
 * Only registration's rows are derived this way. A later grant, re-issued after
 * a revocation or for an Agency Member Account, would use a random UUID and
 * leave the history in `account_access_grants` intact.
 *
 * Access is enforced by row permissions, never by id secrecy.
 */
import { createHash } from 'node:crypto'

/** A constant of the application: changing it changes every derived id. */
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

/** Same input, same ids, on every call and from every process. */
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
