# HAUZ — Personal Account registration

Registration with email verification, login and logout, built on **TanStack Start**, **TypeScript**
and **Appwrite** (Auth, Functions, TablesDB), against the HAUZ Authentication schema supplied with
the assignment.

The schema is used exactly as provided: no table, field, relationship, index or allowed value has
been added, removed, renamed or changed. `docs/` holds the original brief and ERD, plus
[design notes](docs/design-notes.md) explaining why the implementation looks the way it does.

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
#    (or export those three in your shell instead — see below, no file needed)

# 3. In the Appwrite console: Settings -> Platforms -> Add platform -> Web,
#    hostname `localhost`. Appwrite refuses to send a verification email to a
#    URL whose hostname is not a registered Web platform.

# 4. Check the credentials before anything is created (read-only)
npm run preflight

# 5. Create the schema in your Appwrite project
#    (database, four tables, every column and index, and the two personal_roles rows)
npm run setup:appwrite

# 6. Give the Appwrite CLI an endpoint and a key, without an interactive login.
#    The two values have to reach this one command as flags; skip the first
#    line if you exported them yourself instead of using a .env file.
set -a; . ./.env; set +a
npx appwrite client --endpoint "$APPWRITE_ENDPOINT" --key "$APPWRITE_API_KEY"

# 7. Deploy the provisioning Appwrite Function
npm run deploy:function

# 8. Only if APPWRITE_DATABASE_ID is not "hauz": tell the function which
#    database to use. `npm run preflight` checks this for you.
npx appwrite functions create-variable --function-id hauz-account-provisioning \
    --variable-id dbid --key APPWRITE_DATABASE_ID --value "$APPWRITE_DATABASE_ID"

# 9. Confirm, then run
npm run preflight
npm run dev                              # http://localhost:3000
```

Steps 5 and 7 are idempotent and safe to re-run. `npm run preflight` is read-only: it creates nothing,
reports which setup steps are still outstanding, and prints the command that fixes each one. Run it
whenever something does not behave.

Step 6 writes the endpoint and key to `~/.appwrite/`, never into the repository. The project id is
deliberately not given to the CLI: `appwrite client --project-id` and `appwrite init project` both
write it into `appwrite.config.json`, which is committed. `npm run deploy:function` reads
`APPWRITE_PROJECT_ID` from the environment, which the CLI prefers over that file, so `projectId`
stays `""` in the repository and the push still knows where to go.

> If you ever do run one of those two commands, reset `projectId` to `""` before committing.

Alternatively, deploy the function from the Appwrite console: create a function with id
`hauz-account-provisioning`, runtime `node-22`, entrypoint `dist/main.js`, build command
`npm install && npm run build`, and upload the `functions/hauz-account-provisioning` directory.

---

## Environment variables

Every project-specific value is read at runtime. Nothing about a particular Appwrite project is
compiled into the application, so pointing it at a different project means changing configuration and
restarting. No code changes.

**No secret has to live in a file.** Everything is read from `process.env`. A `.env` file is one way
to populate it, and the only one that is convenient locally, but exporting the variables in your
shell, your process manager or a secret store works identically:

```bash
export APPWRITE_ENDPOINT=https://fra.cloud.appwrite.io/v1
export APPWRITE_PROJECT_ID=…
export APPWRITE_API_KEY=…
npm run preflight && npm run dev
```

`.env` is in `.gitignore` and has never been committed; `.env.example` documents the names and
carries no values. In development the file is loaded for you if it exists; a production run
(`npm run build && npm start`) reads the process environment only, so there the variables have to be
exported — which is what you want of a deployment anyway.

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
| `HAUZ_PROVISIONING_STRATEGY`        | no       | `auto`                      | Function-side: `auto`, `transaction` or `compensation` |

`APP_URL` is optional because the verification link is built from the origin of the incoming request
when it is unset, which is what you want on localhost and on preview deployments. Set it when the
app sits behind a proxy that rewrites the host.

**API key scopes.** The key in `.env` is used by the application for `users.read`, `users.write` and
`sessions.write`, by `npm run setup:appwrite` for `databases.*`, `tables.*`, `columns.*`, `indexes.*`
and `rows.*`, and by `npm run preflight` for `functions.read`. They are listed per operation in
`.env.example`. The Appwrite Function does **not** use this key; it receives a scoped dynamic key
from Appwrite at execution time.

**Email verification needs no configuration at all.** Only the first three variables in the table are
required. Appwrite mints the token, renders the message, sends it over the project's SMTP, validates
the secret when the link comes back and owns the `emailVerification` flag that results; this
application adds nothing to that but a send timestamp, so the 60-second resend interval can be
enforced on the server. What decides whether the message arrives lives in the console, not in the
environment: a Web platform for the hostname, and SMTP under **Auth → SMTP** (Appwrite Cloud's shared
sender works, but is rate-limited and often filtered as spam).

**Verifying without email.** If the message does not arrive — a filtered shared sender, a throwaway
address — nothing has to be configured to get past it. Open **Auth → the user → Email verification**
in the Appwrite console and switch it on. The next page load re-reads the session from Appwrite, sees
a verified address, and takes the account to the dashboard; `/verify-email` also has an "I have
confirmed it" button that does the same thing without a reload. The verification flag lives on the
Appwrite Auth user, so the console is simply the other way to set it.

---

## Appwrite console settings

**Auth → Settings** — email/password sign-in enabled; SMTP configured if you want Appwrite itself to
send the verification email.

**Settings → Platforms** — add a **Web** platform for every hostname the app runs on (`localhost`,
your deploy domain). Appwrite rejects a verification `url` whose hostname is not registered, which is
what prevents the verification link from being used as an open redirect.

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

## Where the code lives

```
src/
  client/     the browser half: routes, components, the form hook
  server/     the server half: Appwrite clients, session, HAUZ reads, email
  shared/     what both halves need: auth state machine, input schemas, result shape

shared/       the HAUZ schema, shared with the Appwrite Function below
functions/    hauz-account-provisioning, the only writer of HAUZ rows
scripts/      setup, preflight and schema checks
```

`src/` is split by where the code runs, and the build enforces the split: every module under
`server/` ends in `.server.ts`, and TanStack Start refuses to bundle a `*.server.*` file into the
browser. The single exception is `server/auth/actions.ts`, the RPC surface that pages call. That one
is meant to be imported from the client, and the framework turns each call into a fetch.
[Design notes](docs/design-notes.md#project-layout) walk through the whole tree.

---

## How registration works

Ordered by dependency, in [`src/server/auth/actions.ts`](src/server/auth/actions.ts):

1. **Create the Appwrite Auth user**, the identity that owns the email address and password.
2. **Store the profile on that user's preferences**: first name, last name, role, phone. This is
   what makes an interrupted registration recoverable without asking for anything again.
3. **Open a session** and write the secret to an httpOnly cookie. Steps 4 and 5 act _as_ this person.
4. **Create the HAUZ records** by executing the provisioning Function with the user's JWT: one
   `accounts` row, one `account_access_grants` row, one `personal_accounts` row, in one transaction
   (or, where the deployment has no transactions, as writes that are undone together on failure).
5. **Send the verification email.**

Registration is reported as complete only when steps 1–4 succeeded. If step 4 fails, the person is
signed in and sent to `/complete-registration`, which retries with one button. If step 5 fails they
land on `/verify-email`, which states plainly that registration is unfinished and offers to send the
email again. Neither page claims success.

Because any of those outcomes can be missing when someone comes back later, the session resolves to
one of five states, each with exactly one correct next page:

| State        | Meaning                             | Next step                |
| ------------ | ----------------------------------- | ------------------------ |
| `anonymous`  | no session, or one Appwrite rejects | `/login`                 |
| `incomplete` | signed in, but no HAUZ records      | `/complete-registration` |
| `blocked`    | account blocked or terminated       | `/blocked`               |
| `unverified` | provisioned, email unconfirmed      | `/verify-email`          |
| `ready`      | fully registered                    | `/dashboard`             |

Logging in also repairs an `incomplete` account automatically, and sends the verification email that
the interrupted run never sent.

---

## Assumptions and limitations

- **Tests are not included.** The brief states they are not required.
- **Phone numbers must be entered in international format** (`+998901234567`). Without a country
  prefix there is nothing to normalise against, and storing an ambiguous number seemed worse than
  rejecting it. The browser checks the shape; the server decides whether the number is real.
- **Four indexes from the supplied schema cover relationship columns** (`ix_grants_account_history`,
  `ix_grants_user_account`, `uq_personal_account`, `ix_personal_role`), which some Appwrite versions,
  including Cloud today, refuse to index. The setup script always attempts them and reports any
  rejection instead of hiding it. Nothing depends on them at runtime.
- **A failed provisioning leaves an Appwrite Auth user with no HAUZ records.** That is deliberate:
  deleting the Auth user would make a retry with the same email address confusing and is itself racy.
  The state is recoverable, self-healing on next login, and never produces duplicates. It is not a
  partial _HAUZ_ record: the HAUZ side is all-or-nothing.
- **The table ids are part of the schema, not configuration.** `npm run setup:appwrite` creates
  `accounts`, `account_access_grants`, `personal_accounts` and `personal_roles` under exactly those
  ids, inside the database named by `APPWRITE_DATABASE_ID`. If your project already holds these
  tables under different ids, point `APPWRITE_DATABASE_ID` at a fresh database and let the script
  build its own; the ids are declared in [`shared/hauz-schema.ts`](shared/hauz-schema.ts).
- **Row-level security must stay enabled** on `accounts`, `account_access_grants` and
  `personal_accounts`. The setup script enables it and re-applies it on every run. Reads depend on it.
- **Verification emails are limited to one per account per 60 seconds,** enforced on the server from
  a timestamp on the Auth user, not by the countdown in the page.
- **`getAuthState` runs on every navigation.** No Appwrite call at all without a session cookie, two
  or three with one, in exchange for a session that is always freshly confirmed rather than cached in
  the browser. A larger application would cache it with a short TTL.
- **Verification is entirely Appwrite's,** including delivery. That keeps expiry, single use and the
  verified flag in one place instead of splitting them across a mail provider, but it does mean
  deliverability is your Appwrite project's SMTP setting. If a message does not arrive, the console
  route below gets past it without any configuration.
- **A verification link opened where there is no session needs a sign-in first.** Appwrite Cloud
  closes `/account` to API-key callers, so the secret cannot be exchanged without a user context. The
  link is not lost: `/verify` sends the person to sign in and returns them to it unchanged.

---

## Troubleshooting

**Anything at all** — run `npm run preflight` first. It reports which setup steps are still
outstanding and prints the command that fixes each one.

| Symptom                                            | Cause                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Every page shows "Something went wrong"            | Appwrite unreachable or the wrong project. The server log names the failure; "Start again" clears the cookie                   |
| `Invalid url param: URL host must be one of…`      | The app's hostname is not registered as a Web platform in the Appwrite console                                                 |
| Registration fails with a table not found          | `APPWRITE_DATABASE_ID` is not `hauz` and the function variable was not set (step 8)                                            |
| Function returns `role_not_found`                  | `personal_roles` has not been seeded — run `npm run setup:appwrite`                                                            |
| Function returns `unauthenticated`                 | The function's _Execute access_ does not include `users`                                                                       |
| Dashboard says "finish setting up" despite records | The visitor's own session cannot read its rows: row security was switched off on a table. `npm run setup:appwrite` restores it |
| Verification email never arrives                   | See "Verifying without email" below — no configuration needed                                                                  |
| "Invalid server environment"                       | A variable in `.env` is missing or malformed. The message names each offending key                                             |
| `project_not_found` in the server log              | `APPWRITE_PROJECT_ID` or `APPWRITE_ENDPOINT` is wrong (Cloud endpoints are region-specific)                                    |
| The first page after `npm run dev` reloads itself  | Vite optimizing dependencies on a cold cache. Expected once per clone; let it settle before using a form                       |

---

## Scripts

`npm run dev` · `build` · `start` · `preflight` · `setup:appwrite` · `deploy:function` · `lint` ·
`typecheck` · `verify` (runs every check in order). The full table is in
[design notes](docs/design-notes.md#scripts).

---

## Out of scope

Password recovery, phone verification, MFA, OAuth, account switching, Agency Member Accounts and
Staff Accounts are outside this task and are not implemented. Only `individual` accounts are created,
which is what the supplied schema covers.
