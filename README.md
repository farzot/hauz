# HAUZ — Personal Account registration

Registration with email verification, login, and logout, built on **TanStack Start**,
**TypeScript** and **Appwrite** (Auth, Functions, TablesDB), against the HAUZ Authentication
schema supplied with the assignment.

The schema is used exactly as provided. No table, field, relationship, index or allowed value has
been added, removed, renamed or changed. `docs/` holds the original brief and ERD.

---

## Contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Appwrite console settings](#appwrite-console-settings)
- [Architecture](#architecture)
- [How registration works](#how-registration-works)
- [Email verification delivery](#email-verification-delivery)
- [Reading the schema](#reading-the-schema)
- [Security model](#security-model)
- [Correctness: partial and duplicate records](#correctness-partial-and-duplicate-records)
- [Handling incomplete registrations](#handling-incomplete-registrations)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Assumptions and limitations](#assumptions-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Out of scope](#out-of-scope)

---

## Quick start

Node 22+ is required (the Appwrite Function targets the `node-22` runtime).

```bash
# 1. Install
npm install
npm --prefix functions/hauz-account-provisioning install

# 2. Configure
cp .env.example .env
#    fill in APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY

# 3. Check the credentials before anything is created (read-only)
npm run preflight

# 4. Create the schema in your Appwrite project
#    (database, four tables, every column and index, and the two personal_roles rows)
npm run setup:appwrite

# 5. Point the Appwrite CLI at the same project, without an interactive login
set -a; . ./.env; set +a
npx appwrite client --endpoint "$APPWRITE_ENDPOINT" \
                    --project-id "$APPWRITE_PROJECT_ID" \
                    --key "$APPWRITE_API_KEY"

# 6. Deploy the provisioning Appwrite Function
npm run deploy:function

# 7. Only if APPWRITE_DATABASE_ID is not "hauz" — tell the function which
#    database to use. `npm run preflight` checks this for you.
npx appwrite functions create-variable --function-id hauz-account-provisioning \
    --variable-id dbid --key APPWRITE_DATABASE_ID --value "$APPWRITE_DATABASE_ID"

# 8. Confirm, then run
npm run preflight
npm run dev                              # http://localhost:3000
```

Steps 4 and 6 are idempotent — safe to re-run. The setup script prints exactly what it created and
what was already there.

`npm run preflight` is read-only: it creates nothing, reports which setup steps are still
outstanding, and prints the command to fix each one. Run it whenever something does not behave.

The CLI configuration in step 5 is written to `~/.appwrite/`, not into the repository, so no
project-specific value is committed. `appwrite.config.json` keeps `projectId` empty for the same
reason — the CLI uses the project you configured.

> `appwrite push` rewrites `appwrite.config.json` with your project id. That is a local
> convenience, not something to commit: reset the field to `""` before committing so the
> repository stays free of project-specific values.

Alternatively, deploy the function from the Appwrite console: create a function with id
`hauz-account-provisioning`, runtime `node-22`, entrypoint `dist/main.js`, build command
`npm install && npm run build`, and upload the `functions/hauz-account-provisioning` directory.
The settings that matter are listed under [Appwrite console settings](#appwrite-console-settings).

---

## Environment variables

Every project-specific value is read at runtime. Nothing about a particular Appwrite project is
compiled into the application, so pointing it at a different project means editing `.env` and
restarting — no code changes.

| Variable                            | Required | Default                     | Purpose                                                |
| ----------------------------------- | -------- | --------------------------- | ------------------------------------------------------ |
| `APPWRITE_ENDPOINT`                 | yes      | —                           | API endpoint including `/v1`                           |
| `APPWRITE_PROJECT_ID`               | yes      | —                           | Appwrite project id                                    |
| `APPWRITE_API_KEY`                  | yes      | —                           | Server-side key. Never reaches the browser             |
| `APPWRITE_DATABASE_ID`              | no       | `hauz`                      | Database holding the HAUZ tables                       |
| `APPWRITE_DATABASE_NAME`            | no       | `HAUZ`                      | Display name, used by the setup script only            |
| `APPWRITE_PROVISIONING_FUNCTION_ID` | no       | `hauz-account-provisioning` | Function to invoke                                     |
| `APP_URL`                           | no       | request origin              | Origin for the verification link                       |
| `SESSION_COOKIE_NAME`               | no       | `hauz_session`              | Cookie holding the session secret                      |
| `EMAIL_TRANSPORT`                   | no       | auto                        | `appwrite` or `resend`; see below                      |
| `RESEND_API_KEY`                    | no       | —                           | Required when the transport is `resend`                |
| `EMAIL_FROM`                        | no       | —                           | Sender, `Name <address@domain>`                        |
| `HAUZ_PROVISIONING_STRATEGY`        | no       | `auto`                      | Function-side: `auto`, `transaction` or `compensation` |

`APP_URL` is optional because the verification link is built from the origin of the incoming
request when it is unset — which is what you want on localhost and on preview deployments. Set it
when the app sits behind a proxy that rewrites the host.

### API key scopes

The key in `.env` is used by the application for `users.read`, `users.write` and `sessions.write`,
and by `npm run setup:appwrite` for `databases.*`, `tables.*`, `columns.*`, `indexes.*` and
`rows.*`. The scopes are listed per operation in `.env.example`.

The Appwrite Function does **not** use this key. It receives a scoped dynamic key from Appwrite at
execution time, in the `x-appwrite-key` header.

---

## Appwrite console settings

**Auth → Settings**

- Email/password sign-in enabled.
- SMTP configured, if you want Appwrite itself to send the verification email. On Appwrite Cloud's
  free plan a custom SMTP server is a Pro feature and the shared sender is rate-limited and
  frequently filtered as spam, so this deployment can send through Resend instead — see
  [Email verification delivery](#email-verification-delivery). Nothing in the application changes
  either way.

**Settings → Platforms**

- Add a **Web** platform for every hostname the app runs on (`localhost`, your deploy domain).
  Appwrite rejects a verification `url` whose hostname is not registered — that restriction is what
  prevents the verification link from being used as an open redirect.

**Functions → hauz-account-provisioning → Settings**

| Setting        | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Execute access | `users` — any authenticated user may run it for themselves               |
| Scopes         | `users.read`, `databases.read`, `tables.read`, `rows.read`, `rows.write` |
| Entrypoint     | `dist/main.js`                                                           |
| Build command  | `npm install && npm run build`                                           |
| Timeout        | 30s                                                                      |

These are already declared in [`appwrite.config.json`](appwrite.config.json), so
`appwrite push function` applies them for you.

---

## Architecture

```
browser
   │  HTML forms, no Appwrite SDK, no credentials, no session in JS
   ▼
TanStack Start server functions              ← src/server/auth.ts
   │  validates input, owns the httpOnly session cookie
   │
   ├─ admin client   (API key)   → Appwrite Auth: create user, open session
   ├─ session client (session)   → Appwrite Auth: read account, verify email, sign out
   │                             → TablesDB: read the caller's own rows
   └─ JWT client     (user JWT)  → Functions: execute provisioning
                                        │
                                        ▼
                        hauz-account-provisioning  (Appwrite Function)
                          dynamic API key, TablesDB writes only
                                        │
                                        ▼
                    accounts · account_access_grants · personal_accounts
```

Three deliberate boundaries:

**The browser never talks to Appwrite.** There is no client-side Appwrite SDK in the bundle. The
only thing the browser holds is an httpOnly cookie on the application's own origin, which scripts
in the page cannot read. This also sidesteps third-party-cookie blocking: staying signed in across
a refresh works in Safari and in Firefox with strict privacy settings, which a browser-SDK
integration on a separate domain does not.

**Only the Appwrite Function writes HAUZ rows.** No table grants create, update or delete to any
client role. A user therefore cannot forge an access grant for someone else's account, set
`status`, or pick an `account_type`, even by calling the Appwrite API directly with their own
session.

**Reads are enforced by Appwrite, not by us.** The Function stamps each row with
`read("user:<id>")` and the three user-owned tables have row-level security enabled. The
application reads them with the _visitor's own session_, so Appwrite returns their records and
nothing else. A filtering mistake in application code cannot expose another person's data, because
application code is not what does the filtering.

---

## How registration works

Ordered by dependency, in [`src/server/auth.ts`](src/server/auth.ts):

1. **Create the Appwrite Auth user** — the identity that owns the email address and password.
2. **Store the profile on that user's preferences** — first name, last name, role, phone. This is
   recovery data; see [below](#handling-incomplete-registrations).
3. **Open a session** and write the secret to the httpOnly cookie. Steps 4 and 5 need to act _as_
   this person.
4. **Create the HAUZ records** by executing the provisioning Function with the user's JWT.
5. **Send the verification email**.

Registration is reported as complete only when steps 1–4 succeeded. If step 4 fails the person is
signed in and sent to `/complete-registration`, which retries. If step 5 fails they land on
`/verify-email`, which states plainly that registration is unfinished and offers to send the email
again — it never claims success.

The Function then does, in [`functions/hauz-account-provisioning/src/provision.ts`](functions/hauz-account-provisioning/src/provision.ts):

1. Reads the Auth user id from `x-appwrite-user-id`. Appwrite derives that header from the JWT, so
   it cannot be forged; a user id in the request body is ignored.
2. Looks for an unrevoked `account_access_grants` row for that user. If one exists, it returns it
   and writes nothing.
3. Resolves the profile — from the request, or from the Auth user's preferences on a retry.
4. Looks up the `personal_roles` row by `value`. Role ids are never hard-coded, and the row is
   never created: the assignment treats those two rows as existing data.
5. Writes three rows in one transaction.

---

## Email verification delivery

Verification has one outcome — `emailVerification` true on the Appwrite Auth user, set only after
the person proved they received the message — reachable two ways. Which one runs is decided by
configuration; no application code differs between them.

|                      | `appwrite` (default)                    | `resend`                                                     |
| -------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Token minted by      | Appwrite                                | Appwrite (`users.createToken`)                               |
| Email rendered by    | Appwrite                                | this application                                             |
| Email delivered by   | the project's SMTP                      | Resend                                                       |
| Token validated by   | Appwrite (`account.updateVerification`) | Appwrite (`account.createSession`)                           |
| Verified flag set by | Appwrite                                | `users.updateEmailVerification`, after the token is accepted |

Set `RESEND_API_KEY` and `EMAIL_FROM` to use Resend; leave them blank for the Appwrite path.
`EMAIL_TRANSPORT` is the explicit override. Implementation:
[`src/lib/email/verification.server.ts`](src/lib/email/verification.server.ts).

**The Resend transport does not invent its own token.** It asks Appwrite for one, mails it, and
later exchanges it. Appwrite therefore stays the authority on expiry, single use and validity —
there is no hand-rolled crypto and no verification state kept outside Appwrite Auth. Exchanging the
token also produces a session, so a link opened on a second device signs the person in rather than
stranding them at a login form.

Why it exists: Appwrite Cloud's free plan cannot use a custom SMTP server, and its shared sender is
unreliable. A reviewer connecting a project that _can_ send mail should leave the Resend variables
empty and get the canonical Appwrite flow.

With no verified domain, Resend's shared sender `onboarding@resend.dev` only delivers to the
address that owns the Resend account. That is enough for development; anything wider needs a
verified domain.

---

## Reading the schema

A few properties of the supplied schema shaped the implementation.

**`current_access_grant_id` is a varchar(36), not a relationship.** `accounts` points at a grant and
the grant points back at the account — a cycle that would normally force insert-then-update. Because
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
are written as `null`, not omitted. `contact_phone` is `null` when not supplied — never an empty
string.

**`accounts.status` is honoured at runtime.** A blocked or terminated account does not reach the
authenticated page even with a valid, verified session — see [`src/routes/blocked.tsx`](src/routes/blocked.tsx).

**The lookup path follows the ERD.** The application never shortcuts from an Auth user to an
account: it starts at `account_access_grants` filtered by `appwrite_user_id` with `revoked_at` null
— exactly what `ix_grants_user_access` exists to serve.

**No email column.** The email address lives in Appwrite Auth and is not duplicated into
`personal_accounts`; nor is verification state, which is Appwrite's `emailVerification` flag.

The whole schema is declared once, machine-readably, in
[`shared/hauz-schema.ts`](shared/hauz-schema.ts). The setup script executes that declaration, so
what is created and what is documented cannot drift apart. Because "the schema is final" is the
constraint the whole task rests on, `npm run check:schema` diffs that declaration against the table,
column, index and enum names transcribed by hand from the brief, and fails the build on any
difference. It runs first in `npm run verify`.

---

## Security model

| Concern                     | How it is handled                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Credentials in the browser  | None. No Appwrite SDK, endpoint or key is bundled client-side                                                              |
| Session theft via XSS       | Session secret in an httpOnly, SameSite=Lax cookie                                                                         |
| Cross-site request forgery  | `SameSite=Lax` blocks the cross-site POST; a request-origin check on every mutating request is the second lock             |
| Verification email flooding | One email per account per 60s, enforced on the server from a timestamp on the Auth user — not by the countdown in the page |
| Session lifetime            | Cookie `maxAge` matches Appwrite's session expiry                                                                          |
| Route protection            | `beforeLoad` runs during SSR; a signed-out visitor is redirected before any authenticated HTML is produced                 |
| Identity spoofing           | The Function trusts `x-appwrite-user-id` from the JWT, never the request body                                              |
| Privilege escalation        | No client role has write permission on any HAUZ table                                                                      |
| Reading others' data        | Row-level permissions; reads use the visitor's own session                                                                 |
| Open redirect               | `?next=` accepts same-origin paths only; the verification `url` must match a registered platform                           |
| User enumeration            | Login returns one message for "no such user" and "wrong password"                                                          |
| Error leakage               | Appwrite exceptions are mapped to fixed messages; details go to the server log                                             |
| Unhandled failures          | A route that throws renders a recovery page, not a stack trace; the reason is logged server-side                           |
| Input validation            | The same zod schema runs in the browser, in the server function, and again inside the Function                             |
| Double submit               | The submit button is disabled while a request is in flight, and provisioning is idempotent regardless                      |

The origin check lives in [`src/start.ts`](src/start.ts) and is scoped to methods that change
state. Applying it to every request would reject ordinary cross-site navigation — including the
verification link, which arrives from a mail client as `Sec-Fetch-Site: cross-site` and must open
normally. Reads are left alone: a cross-origin caller can make `getAuthState` run but cannot read
its response without a CORS grant, which is not given.

---

## Correctness: partial and duplicate records

Two failure modes matter here, and they are handled separately.

### Partial records

The three inserts run inside a **TablesDB transaction** (`createTransaction` → `createRow` ×3 →
`updateTransaction { commit: true }`). Any failure rolls back; nothing half-written survives. If
the rollback call itself fails, the transaction still expires on its own after its TTL.

Transactions are a recent TablesDB feature. If the target Appwrite deployment does not have them,
the Function falls back to **compensating writes**: each successful insert is paired with an undo
that runs in reverse order on failure, so the observable outcome is still all-or-nothing. The
strategy is selected automatically and can be pinned with `HAUZ_PROVISIONING_STRATEGY`.

### Duplicate records

A query-first check (`appwrite_user_id` + `revoked_at IS NULL`) covers the ordinary retry. It does
not, on its own, cover two requests racing — a double-submitted form, a retried request, a
reconnecting client — because both could pass the check before either writes.

So the three registration rows use **RFC 4122 version 5 UUIDs derived from the Appwrite Auth user
id** instead of random ones. The ids are still generated UUIDs, as the assignment requires, but they
are now a function of the user: two concurrent runs compute the same primary keys, and Appwrite
rejects the second with a conflict. The loser then reads back the winner's records and reports
success, because exactly one set exists — which is the actual guarantee wanted.

The derivation is scoped to the rows registration creates. Any later grant — one re-issued after a
revocation, or one for an Agency Member Account — would use a random UUID, so the history
`account_access_grants` is designed to keep is unaffected. See
[`shared/hauz-ids.ts`](shared/hauz-ids.ts).

---

## Handling incomplete registrations

Registration has three independent outcomes, and any of them can be missing when someone returns to
the site. [`src/lib/auth/model.ts`](src/lib/auth/model.ts) names every combination, so each route
has exactly one correct next step rather than a pair of booleans to reinterpret:

| State        | Meaning                             | Next step                |
| ------------ | ----------------------------------- | ------------------------ |
| `anonymous`  | no session, or one Appwrite rejects | `/login`                 |
| `incomplete` | signed in, but no HAUZ records      | `/complete-registration` |
| `unverified` | provisioned, email unconfirmed      | `/verify-email`          |
| `blocked`    | account blocked or terminated       | `/blocked`               |
| `ready`      | fully registered                    | `/dashboard`             |

Recovery needs nothing from the person. The profile was stored on the Auth user's preferences
during registration, so the Function reads it from there — `/complete-registration` is a single
button, and **logging in also repairs the account automatically** before deciding where to send
them. Retrying is safe because provisioning is idempotent.

A session Appwrite no longer accepts clears the cookie on the way out, so an expired or remotely
revoked session cannot leave the browser stuck in a signed-in shell.

---

## Project layout

```
shared/                          canonical schema — the single source of truth
  hauz-schema.ts                   tables, columns, indexes, allowed values, zod schemas
  hauz-ids.ts                      UUIDv5 derivation for registration rows

scripts/
  preflight.ts                     read-only check of .env and the Appwrite project
  setup-appwrite.ts                creates the schema and seeds personal_roles (idempotent)
  check-schema.ts                  asserts the declaration still matches the assignment
  sync-shared.ts                   mirrors shared/ into the Function; --check fails on drift

functions/hauz-account-provisioning/
  src/main.ts                      HTTP entrypoint, auth, request validation
  src/provision.ts                 idempotent, transactional record creation
  src/shared/                      generated copy of shared/ — do not edit

src/
  lib/
    env.server.ts                  validated configuration
    appwrite/clients.server.ts     admin / session / JWT clients
    appwrite/errors.ts             Appwrite exceptions → messages a person can act on
    auth/model.ts                  auth state machine (browser-safe)
    auth/schemas.ts                zod input schemas, E.164 normalisation
    auth/session.server.ts         httpOnly session cookie
    auth/state.server.ts           cookie → auth state
    hauz/hauz.server.ts            HAUZ reads; delegates writes to the Function
    use-form-action.ts             form ↔ schema ↔ server function
  server/auth.ts                   register, login, logout, verify, resume
  routes/                          register, login, verify-email, verify,
                                   complete-registration, blocked, dashboard
```

Because an Appwrite Function is deployed as a self-contained directory, the shared modules are
mirrored into it by `npm run sync:shared`. `npm run check:shared` fails the build if the copies
drift, so the two halves of the system provably describe the same schema.

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
| `npm run verify`                           | Everything above, in order                                   |

---

## Assumptions and limitations

- **Tests are not included.** The brief states they are not required.
- **Email delivery is pluggable, verification is not.** The Resend transport exists only because
  Appwrite Cloud's free plan cannot send reliably. Appwrite still mints and validates every token,
  and the verified flag lives where it belongs — on the Appwrite Auth user.
- **Phone numbers must be entered in international format** (`+998901234567`). Validation is split:
  the browser strips separators and checks the E.164 shape, so typos are caught without a round
  trip, while whether the number is one anyone could dial is settled on the server in
  [`src/lib/phone.server.ts`](src/lib/phone.server.ts). That keeps roughly 118 KB of
  numbering-plan metadata — a quarter of the client bundle — out of every page load, and puts the
  authoritative check where it had to be anyway. Without a country prefix there is nothing to
  normalise against, and storing an ambiguous number seemed worse than rejecting it.
- **`onDelete: restrict` is not uniform across relationship types.** Appwrite enforces it for the
  many-to-one grant — an account cannot be deleted while a grant points at it — but a one-to-one
  relationship behaves differently: `personal_accounts` cannot be deleted while its account exists,
  and deleting the account detaches the profile rather than refusing. The two rules constrain
  deletion order in opposite directions, so the compensating cleanup in the provisioning Function
  retries until a pass makes no progress instead of assuming an order.
- **Indexes on relationship columns.** Three indexes in the supplied schema
  (`ix_grants_account_history`, `uq_personal_account`, `ix_personal_role`) cover relationship
  columns, which some Appwrite versions refuse to index. The setup script always attempts them; if
  the platform rejects one it continues and reports it in the run summary rather than failing
  silently. Nothing depends on them at runtime, and `uq_personal_account`'s uniqueness is enforced
  anyway by the one-to-one relationship.
- **A failed provisioning leaves an Appwrite Auth user with no HAUZ records.** That is deliberate.
  Deleting the Auth user would make a retry with the same email address confusing and is itself
  racy; the state is recoverable, self-healing on next login, and never produces duplicates. It is
  not a partial _HAUZ_ record — the HAUZ side is all-or-nothing.
- **`getAuthState` runs on every navigation.** It costs one or three Appwrite calls per page load,
  in exchange for a session that is always freshly confirmed rather than cached in the browser. For
  an application of this size that trade is worth making; a larger one would cache it with a short
  TTL.
- **Verification links opened without a session.** Appwrite accepts the `userId`/`secret` pair on
  its own, so this normally works. If a deployment insists on a session, `/verify` tells the person
  to sign in and returns them to the link with its parameters intact.
- **Verification emails are limited to one per account per 60 seconds.** The limit is enforced in
  `resendVerificationFn` from a timestamp stored on the Auth user, not by the countdown in the
  page — a countdown in the browser is a courtesy, and stops nobody from calling the endpoint in
  a loop. Keeping it on the Auth user rather than in memory means it survives a restart and holds
  across every instance. Appwrite's own rate limiting still applies on top for the `appwrite`
  transport; a 429 is surfaced as a plain message.
- **Relationship columns are read as ids, not nested rows.** A read returns
  `account_id: "<uuid>"` unless the query asks for expansion with
  `Query.select(['*', 'account_id.*'])`. The read path requests expansion and still resolves a bare
  id if a deployment ignores it, so neither behaviour produces a silently empty result.
- **Row-level security must stay enabled** on `accounts`, `account_access_grants` and
  `personal_accounts`. The setup script enables it and re-applies it on every run. Reads depend on
  it: with it off, the dashboard cannot see the visitor's own rows.

---

## Troubleshooting

**Every page shows "Something went wrong"** — the deployment cannot reach Appwrite, or points at the
wrong project. The server log names the exact failure. "Start again" on that page clears the session
cookie, which unblocks a browser holding one Appwrite rejects for any reason other than 401.

**Anything at all** — run `npm run preflight` first. It reports which setup steps are still
outstanding and prints the command that fixes each one.

**Registration fails with a table not found** — the function is looking for a database called
`hauz`. If `APPWRITE_DATABASE_ID` is anything else, set the same value as a function environment
variable (step 7 of the quick start). `npm run preflight` checks this.

**"Invalid server environment"** — a variable in `.env` is missing or malformed. The message names
each offending key.

**Verification email never arrives** — check which transport is active with `npm run preflight`. On
`appwrite`, the project has no working SMTP; on `resend`, the sender is probably
`onboarding@resend.dev`, which only delivers to the address that owns the Resend account. The
server log records the exact reason Resend gave.

**`Invalid url param: URL host must be one of...`** when registering — the app's hostname is not
registered as a Web platform in the Appwrite console.

**Function returns `role_not_found`** — `personal_roles` has not been seeded. Run
`npm run setup:appwrite`.

**Function returns `unauthenticated`** — it was executed without a user JWT. Check that its
_Execute access_ includes `users`.

**Dashboard shows "finish setting up" for an account that has records** — the function's dynamic
API key is missing `rows.read`, or row security was switched off on one of the tables. Re-run
`npm run setup:appwrite`, which restores the permission model.

**`project_not_found` in the server log** — `APPWRITE_PROJECT_ID` or `APPWRITE_ENDPOINT` is wrong.
Appwrite Cloud endpoints are region-specific, e.g. `https://fra.cloud.appwrite.io/v1`.

---

## Out of scope

Password recovery, phone verification, MFA, OAuth, account switching, Agency Member Accounts and
Staff Accounts are outside this task and are not implemented. Only `individual` accounts are
created, which is what the supplied schema covers.
