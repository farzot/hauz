# hauz-account-provisioning

Appwrite Function. Creates the HAUZ records for a registered person: one `individual` account, the
`account_access_grants` row that connects it to their Appwrite Auth user, and their
`personal_accounts` profile.

This is the **only** code in the system that writes to the HAUZ tables. No client — and no part of
the web application — holds credentials able to create an account, issue an access grant, or choose
an account status.

## Contract

`POST /`, executed with the caller's JWT.

```jsonc
// request body — optional
{
  "profile": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "role": "consumer", // "consumer" | "realtor"
    "contactPhone": "+998901234567", // or null
  },
}
```

Omit the body to re-run provisioning for an account whose registration did not finish; the profile
is then recovered from the Auth user's preferences.

```jsonc
// 200
{ "ok": true, "created": true, "accountId": "…", "grantId": "…", "personalAccountId": "…" }

// 400 invalid_request · 401 unauthenticated · 403 access_revoked
// 405 invalid_request (anything but POST) · 422 missing_profile
// 500 role_not_found · 500 provisioning_failed
{ "ok": false, "code": "…", "message": "…" }
```

`created: false` means the records already existed. Calling repeatedly is safe.

## Identity

The Appwrite Auth user id is read from the `x-appwrite-user-id` header, which Appwrite derives from
the caller's JWT. A user id in the request body is ignored.

## Credentials

The dynamic API key in `x-appwrite-key`, scoped in the Appwrite console. Nothing is hard-coded.
`APPWRITE_API_KEY` is read as a fallback for running the function outside Appwrite.

## Settings

| Setting        | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Runtime        | `node-22`                                                                |
| Entrypoint     | `dist/main.js`                                                           |
| Build command  | `npm install && npm run build`                                           |
| Execute access | `users`                                                                  |
| Scopes         | `users.read`, `databases.read`, `tables.read`, `rows.read`, `rows.write` |
| Timeout        | 30s                                                                      |

| Environment variable         | Default | Purpose                                 |
| ---------------------------- | ------- | --------------------------------------- |
| `APPWRITE_DATABASE_ID`       | `hauz`  | Database holding the HAUZ tables        |
| `HAUZ_PROVISIONING_STRATEGY` | `auto`  | `auto`, `transaction` or `compensation` |

`APPWRITE_FUNCTION_API_ENDPOINT` and `APPWRITE_FUNCTION_PROJECT_ID` are injected by Appwrite.

## Guarantees

**Atomic.** The three inserts run in one TablesDB transaction; any failure rolls back. Where
transactions are unavailable, every successful write is undone on failure, so the outcome is still
all-or-nothing. The undo retries until a pass makes no progress rather than assuming a delete order,
because Appwrite enforces `restrict` differently for one-to-one and many-to-one relationships.

**Idempotent under concurrency.** An unrevoked grant with a `personal_accounts` row behind it
short-circuits the whole function — both, because a grant on its own is what a cleanup that could
not finish leaves behind, and reporting that as "done" would disagree with what the application can
read. Racing requests are caught by the primary key: the three row ids are UUIDv5 values derived from
the Auth user id, so two concurrent runs compute the same keys and only one can win. The loser reads
back the winner's records and reports success.

**Self-repairing.** A grant left without its profile is completed on the next call rather than
reported as finished. A grant that was deliberately revoked is not: re-granting access is an operator
decision, so that case returns `access_revoked` instead.

## Development

```bash
npm install
npm run typecheck
npm run build          # → dist/
```

`src/shared/` is generated from the repository's `shared/` directory by
`npm run sync:shared` at the repository root. Edit the originals, not the copies.
