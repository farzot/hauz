# Design notes

Why this implementation looks the way it does. [`README.md`](../README.md) is enough to run the
application; this file is the reasoning behind it.

- [Architecture](#architecture)
- [Reading the schema](#reading-the-schema)
- [Correctness: partial and duplicate records](#correctness-partial-and-duplicate-records)
- [The auth state machine](#the-auth-state-machine)
- [Security model](#security-model)
- [Email verification delivery](#email-verification-delivery)
- [Appwrite quirks worth knowing](#appwrite-quirks-worth-knowing)
- [Project layout](#project-layout)
- [Scripts](#scripts)

---

## Architecture

```
browser
   │  HTML forms, no Appwrite SDK, no credentials, no session in JS
   ▼
TanStack Start server functions              ← src/server/auth/actions.ts
   │  validates input, owns the httpOnly session cookie
   │
   ├─ admin client   (API key)   → Appwrite Auth only: create user, open session,
   │                               mint and exchange verification tokens
   ├─ session client (session)   → Appwrite Auth: read account, verify email, sign out
   │                             → TablesDB: read the caller's own rows
   └─ JWT client     (user JWT)  → Functions: execute provisioning
                                        │
                                        ▼
                        hauz-account-provisioning  (Appwrite Function)
                    dynamic API key · the only writer of HAUZ rows
                                        │
                                        ▼
                    accounts · account_access_grants · personal_accounts
```

Three deliberate boundaries:

**The browser never talks to Appwrite.** There is no client-side Appwrite SDK in the bundle. The
only thing the browser holds is an httpOnly cookie on the application's own origin, which scripts in
the page cannot read. This also sidesteps third-party-cookie blocking: staying signed in across a
refresh works in Safari and in Firefox with strict privacy settings, which a browser-SDK integration
on a separate domain does not.

**Only the Appwrite Function writes HAUZ rows.** No table grants create, update or delete to any
client role. A user therefore cannot forge an access grant for someone else's account, set `status`,
or pick an `account_type`, even by calling the Appwrite API directly with their own session.

**Reads are enforced by Appwrite, not by us.** The Function stamps each row with `read("user:<id>")`
and the three user-owned tables have row-level security enabled. The application reads them with the
_visitor's own session_, so Appwrite returns their records and nothing else. A filtering mistake in
application code cannot expose another person's data, because application code is not what does the
filtering.

---

## Reading the schema

A few properties of the supplied schema shaped the implementation.

**`current_access_grant_id` is a varchar(36), not a relationship.** `accounts` points at a grant and
the grant points back at the account, a cycle that would normally force insert-then-update. Because
that column is a plain string with no foreign-key constraint, the grant id can be generated up front
and written into `accounts` before the grant row exists. Registration is therefore **three inserts
and no update**:

```
accounts             { account_type: 'individual', status: 'active',
                       terminated_at: null, current_access_grant_id: <grant id> }
account_access_grants{ appwrite_user_id: <auth $id>, account_id: <account id>, revoked_at: null }
personal_accounts    { account_id, role_id, first_name, last_name, contact_phone }
```

**Relationships are one-way.** A two-way relationship in Appwrite adds a reciprocal column to the
related table. That would add fields to `accounts` and `personal_roles`, which the assignment
forbids. `personal_accounts.account_id` is one-to-one (which enforces the uniqueness
`uq_personal_account` declares); the other two are many-to-one. All use `onDelete: restrict`, so
deletions stay explicit.

**`status` has no default,** so it is set explicitly to `active`. `terminated_at` and `revoked_at`
are written as `null`, not omitted. `contact_phone` is `null` when not supplied, never an empty
string.

**`accounts.status` is honoured at runtime.** A blocked or terminated account does not reach the
authenticated page even with a valid, verified session. See [`src/client/routes/blocked.tsx`](../src/client/routes/blocked.tsx).

**The lookup path follows the ERD.** The application never shortcuts from an Auth user to an
account: it starts at `account_access_grants` filtered by `appwrite_user_id` with `revoked_at` null,
which is exactly what `ix_grants_user_access` exists to serve.

**No email column.** The email address lives in Appwrite Auth and is not duplicated into
`personal_accounts`; nor is verification state, which is Appwrite's `emailVerification` flag.

The whole schema is declared once, machine-readably, in
[`shared/hauz-schema.ts`](../shared/hauz-schema.ts). The setup script executes that declaration, so
what is created and what is documented cannot drift apart. Because "the schema is final" is the
constraint the whole task rests on, `npm run check:schema` diffs that declaration against the table,
column, index and enum names transcribed by hand from the brief, and fails the build on any
difference. It runs first in `npm run verify`.

---

## Correctness: partial and duplicate records

Two failure modes matter here, and they are handled separately.

### Partial records

The three inserts run inside a **TablesDB transaction** (`createTransaction` → `createRow` ×3 →
`updateTransaction { commit: true }`). Any failure rolls back; nothing half-written survives. If the
rollback call itself fails, the transaction still expires on its own after its TTL.

Transactions are a recent TablesDB feature. If the target Appwrite deployment does not have them,
the Function falls back to **compensating writes**: every successful insert is remembered and undone
on failure, so the observable outcome is still all-or-nothing. The undo does not assume a delete
order; see [Appwrite quirks](#appwrite-quirks-worth-knowing). The strategy is selected automatically
and can be pinned with `HAUZ_PROVISIONING_STRATEGY`; the fallback is announced in the function log,
so "it ran in a transaction" is never silently untrue.

### Half-written records

The two mechanisms above cover a run that fails. They do not cover a run whose _cleanup_ also fails:
`deleteAll` gives up when a pass makes no progress, and logs what it could not remove. That can leave
an access grant with no `personal_accounts` row behind it.

So "already provisioned" is defined the same way on both sides: the Function checks for the grant
**and** the profile it leads to, exactly as the application does when it reads these tables back. If
only the grant is there, the next call fills in what is missing instead of reporting success, which
is what previously produced a retry button that appeared to do nothing at all. And if the application
still cannot read the records after the Function reports success, it says so rather than redirecting
to the page the person is already on.

### Duplicate records

A query-first check (`appwrite_user_id` + `revoked_at IS NULL`) covers the ordinary retry. It does
not, on its own, cover two requests racing (a double-submitted form, a retried request, a
reconnecting client), because both could pass the check before either writes.

So the three registration rows use **RFC 4122 version 5 UUIDs derived from the Appwrite Auth user
id** instead of random ones. The ids are still generated UUIDs, as the assignment requires, but they
are now a function of the user: two concurrent runs compute the same primary keys, and Appwrite
rejects the second with a conflict. The loser then reads back the winner's records and reports
success, because exactly one set exists, which is the guarantee that was wanted.

The derivation is scoped to the rows registration creates. Any later grant, one re-issued after a
revocation or one for an Agency Member Account, would use a random UUID, so the history
`account_access_grants` is designed to keep is unaffected. See
[`shared/hauz-ids.ts`](../shared/hauz-ids.ts).

---

## The auth state machine

Registration has three independent outcomes, and any of them can be missing when someone returns to
the site. [`src/shared/auth-model.ts`](../src/shared/auth-model.ts) names every combination, so each route
has exactly one correct next step rather than a pair of booleans to reinterpret:

| State        | Meaning                             | Next step                |
| ------------ | ----------------------------------- | ------------------------ |
| `anonymous`  | no session, or one Appwrite rejects | `/login`                 |
| `incomplete` | signed in, but no HAUZ records      | `/complete-registration` |
| `blocked`    | account blocked or terminated       | `/blocked`               |
| `unverified` | provisioned, email unconfirmed      | `/verify-email`          |
| `ready`      | fully registered                    | `/dashboard`             |

They are evaluated in that order, and the order carries meaning. An account with no HAUZ records is
not registered yet, whatever the state of its email address. A blocked account is not invited to
confirm its address either: it may not be used, so it should not be able to send itself email.

Recovery needs nothing from the person. The profile was stored on the Auth user's preferences during
registration, so the Function reads it from there: `/complete-registration` is a single button, and
**logging in also repairs the account automatically** before deciding where to send them. Retrying
is safe because provisioning is idempotent.

Registration sends the verification email as its last step, so an account repaired later never
reached it. Both recovery paths therefore send that first email themselves. Otherwise the person
lands on `/verify-email` waiting for a message nobody sent. Only the first one is ever sent
automatically; every later send is a deliberate click, rate-limited on the way through.

A session Appwrite no longer accepts clears the cookie on the way out, so an expired or remotely
revoked session cannot leave the browser stuck in a signed-in shell.

---

## Security model

| Concern                     | How it is handled                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Credentials in the browser  | None. No Appwrite SDK, endpoint or key is bundled client-side                                                               |
| Session theft via XSS       | Session secret in an httpOnly, SameSite=Lax cookie                                                                          |
| Cross-site request forgery  | `SameSite=Lax` blocks the cross-site POST; a request-origin check on every mutating request is the second lock              |
| Verification email flooding | One email per account per 60s, enforced on the server from a timestamp on the Auth user — not by the countdown in the page  |
| Session lifetime            | Cookie `maxAge` matches Appwrite's session expiry                                                                           |
| Route protection            | `beforeLoad` runs during SSR; a signed-out visitor is redirected before any authenticated HTML is produced                  |
| Identity spoofing           | The Function trusts `x-appwrite-user-id` from the JWT, never the request body                                               |
| Privilege escalation        | No client role has write permission on any HAUZ table                                                                       |
| Reading others' data        | Row-level permissions; reads use the visitor's own session                                                                  |
| Open redirect               | `?next=` accepts same-origin paths only, rejecting `//` and `/\`; the verification `url` must match a registered platform   |
| User enumeration            | Login returns one message for "no such user" and "wrong password"                                                           |
| Error leakage               | Appwrite exceptions are mapped to fixed messages; details go to the server log                                              |
| Unhandled failures          | A route that throws renders a recovery page, not a stack trace; the reason is logged server-side                            |
| Input validation            | zod at three levels: the browser and the server function share one schema, and the Function validates its own payload again |
| Double submit               | The submit button is disabled while a request is in flight, and provisioning is idempotent regardless                       |

The origin check lives in [`src/server/start.server.ts`](../src/server/start.server.ts) and is scoped to methods that change
state. Applying it to every request would reject ordinary cross-site navigation, including the
verification link, which arrives from a mail client as `Sec-Fetch-Site: cross-site` and must open
normally. Reads are left alone: a cross-origin caller can make `getAuthState` run but cannot read its
response without a CORS grant, which is not given.

---

## Email verification delivery

Verification has one outcome, `emailVerification` true on the Appwrite Auth user, set only after
the person proved they received the message, and two ways to reach it. Configuration decides which
one runs; no application code differs between them.

|                      | `appwrite` (default)                    | `resend`                                                     |
| -------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Token minted by      | Appwrite                                | Appwrite (`users.createToken`)                               |
| Email rendered by    | Appwrite                                | this application                                             |
| Email delivered by   | the project's SMTP                      | Resend                                                       |
| Link lifetime        | 7 days                                  | 24 hours                                                     |
| Token validated by   | Appwrite (`account.updateVerification`) | Appwrite (`account.createSession`)                           |
| Verified flag set by | Appwrite                                | `users.updateEmailVerification`, after the token is accepted |

**The Resend transport does not invent its own token.** It asks Appwrite for one, mails it, and
later exchanges it. Appwrite therefore stays the authority on expiry, single use and validity:
there is no hand-rolled crypto and no verification state kept outside Appwrite Auth. Exchanging the
token also produces a session, so a link opened on a second device signs the person in rather than
stranding them at a login form.

Why it exists: Appwrite Cloud's free plan cannot use a custom SMTP server, and its shared sender is
unreliable. A reviewer connecting a project that _can_ send mail should leave the Resend variables
empty and get the canonical Appwrite flow. Implementation:
[`src/server/auth/verification.server.ts`](../src/server/auth/verification.server.ts).

---

## Appwrite quirks worth knowing

Four things about the platform that the implementation had to work around rather than assume away.

**Relationship columns cannot always be indexed.** Four indexes in the supplied schema
(`ix_grants_account_history`, `ix_grants_user_account`, `uq_personal_account`, `ix_personal_role`)
cover relationship columns, which some Appwrite versions, including Cloud at the time of writing,
refuse to index. The setup script always attempts them and reports any rejection in its run summary,
rather than assuming the platform's answer or hiding it.
Nothing depends on them at runtime, and `uq_personal_account`'s uniqueness is enforced anyway by the
one-to-one relationship.

**`onDelete: restrict` is not uniform across relationship types.** Appwrite enforces it for the
many-to-one grant, so an account cannot be deleted while a grant points at it, but a one-to-one
relationship behaves differently: `personal_accounts` cannot be deleted while its account exists,
and deleting the account detaches the profile rather than refusing. The two rules constrain deletion
order in opposite directions, so the compensating cleanup in the provisioning Function retries until
a pass makes no progress instead of assuming an order.

**Relationship columns are read as ids, not nested rows.** A read returns `account_id: "<uuid>"`
unless the query asks for expansion with `Query.select(['*', 'account_id.*'])`. The read path
requests expansion and still resolves a bare id if a deployment ignores it, so neither behaviour
produces a silently empty result.

**Verification links may be opened without a session.** Appwrite accepts the `userId`/`secret` pair
on its own, so a link opened on another device normally works. If a deployment insists on a session,
`/verify` tells the person to sign in and returns them to the link with its parameters intact.

---

## Project layout

`src/` is split by **where the code runs**, because in a full-stack framework that is the boundary
that actually matters, and the one the bundler enforces.

```
src/
  client/                          the browser half
    routes/                        register, login, verify-email, verify,
                                     complete-registration, blocked, dashboard
    components/                    ui.tsx, error-state, not-found, sign-out-button
    router.tsx                     router instance and its defaults
    routeTree.gen.ts               generated, do not edit
    use-form-action.ts             form ↔ schema ↔ server function
    styles.css

  server/                          the server half; every file ends in `.server.ts`
    auth/
      actions.ts                   the RPC surface: register, login, logout, verify, resume
      session.server.ts            httpOnly session cookie
      state.server.ts              cookie → auth state
      verification.server.ts       email verification, both transports
    appwrite/
      clients.server.ts            admin / session / JWT clients
      errors.server.ts             Appwrite exceptions → messages a person can act on
    env.server.ts                  validated configuration
    hauz.server.ts                 HAUZ reads; delegates writes to the Function
    phone.server.ts                authoritative E.164 validation
    start.server.ts                request middleware (the origin check)

  shared/                          imported by both halves
    action-result.ts               the shape every action returns
    auth-model.ts                  auth state machine
    auth-schemas.ts                zod input schemas, same-origin redirect paths
```

The rest of the repository is the other deployable and the tooling around it:

```
shared/                            the HAUZ schema, shared with the Function
  hauz-schema.ts                     tables, columns, indexes, allowed values, zod schemas
  hauz-ids.ts                        UUIDv5 derivation for registration rows

functions/hauz-account-provisioning/
  src/main.ts                      HTTP entrypoint, auth, request validation
  src/provision.ts                 idempotent, transactional record creation
  src/shared/                      generated copy of shared/, do not edit

scripts/
  preflight.ts                     read-only check of .env and the Appwrite project
  setup-appwrite.ts                creates the schema and seeds personal_roles (idempotent)
  check-schema.ts                  asserts the declaration still matches the assignment
  sync-shared.ts                   mirrors shared/ into the Function; --check fails on drift
```

Two directories are called `shared/`, and the rule is the same for both: each holds what the things
beside it have in common. `src/shared/` is common to `src/client/` and `src/server/`; the top-level
`shared/` is common to `src/` and `functions/`, which is why it, and only it, is mirrored into the
Function by `npm run sync:shared`. `npm run check:shared` fails the build if the copies drift, so
the two halves of the system provably describe the same schema.

### The `.server.ts` suffix is not decoration

TanStack Start's import protection refuses to bundle any `**/*.server.*` module into the browser and
fails the build with the import chain that reached it. That is what makes "no Appwrite SDK, no API
key, no session secret in the client bundle" a property the build enforces rather than a habit.

The one file under `server/` without the suffix is `auth/actions.ts`, and deliberately so: it is the
RPC surface. A page importing `loginFn` is the entire point, and TanStack Start rewrites each
`createServerFn` body into a fetch when it builds the client. Everything that file imports is
`.server.ts`, so the implementation stays behind the boundary while the door stays open.

`src/shared/action-result.ts` exists for the same reason. The type a form renders and the Appwrite
exception mapping that produces it used to live in one module; a component naming the type would
have pulled the Appwrite SDK toward the browser. Splitting them puts the shape somewhere with no
dependencies at all and leaves the mapping in `errors.server.ts`, where the build can police it.

---

## Scripts

| Command                                    | What it does                                                 |
| ------------------------------------------ | ------------------------------------------------------------ |
| `npm run dev`                              | Development server on port 3000                              |
| `npm run build` / `npm start`              | Production build and run                                     |
| `npm run preflight`                        | Read-only check of `.env` and the Appwrite project           |
| `npm run setup:appwrite`                   | Create the schema and seed `personal_roles`                  |
| `npm run check:schema`                     | Fail if the declared schema no longer matches the assignment |
| `npm run sync:shared`                      | Copy `shared/` into the Appwrite Function                    |
| `npm run check:shared`                     | Fail if those copies are stale                               |
| `npm run build:function`                   | Compile the Function to `dist/`                              |
| `npm run deploy:function`                  | Sync, then `appwrite push function`                          |
| `npm run typecheck` / `typecheck:function` | TypeScript, both packages                                    |
| `npm run lint` / `npm run format`          | ESLint / Prettier                                            |
| `npm run verify`                           | Every check that needs no Appwrite project, in order         |
