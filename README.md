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

# 3. Check the credentials before anything is created (read-only)
npm run preflight

# 4. Create the schema in your Appwrite project
#    (database, four tables, every column and index, and the two personal_roles rows)
npm run setup:appwrite

# 5. Give the Appwrite CLI an endpoint and a key, without an interactive login
set -a; . ./.env; set +a
npx appwrite client --endpoint "$APPWRITE_ENDPOINT" --key "$APPWRITE_API_KEY"

# 6. Deploy the provisioning Appwrite Function
npm run deploy:function

# 7. Only if APPWRITE_DATABASE_ID is not "hauz": tell the function which
#    database to use. `npm run preflight` checks this for you.
npx appwrite functions create-variable --function-id hauz-account-provisioning \
    --variable-id dbid --key APPWRITE_DATABASE_ID --value "$APPWRITE_DATABASE_ID"

# 8. Confirm, then run
npm run preflight
npm run dev                              # http://localhost:3000
```

Steps 4 and 6 are idempotent and safe to re-run. `npm run preflight` is read-only: it creates nothing,
reports which setup steps are still outstanding, and prints the command that fixes each one. Run it
whenever something does not behave.

Step 5 writes the endpoint and key to `~/.appwrite/`, never into the repository. The project id is
deliberately not given to the CLI: `appwrite client --project-id` and `appwrite init project` both
write it into `appwrite.config.json`, which is committed. `npm run deploy:function` loads `.env`
instead, and the CLI reads `APPWRITE_PROJECT_ID` from the environment ahead of that file, so
`projectId` stays `""` in the repository and the push still knows where to go.

> If you ever do run one of those two commands, reset `projectId` to `""` before committing.

Alternatively, deploy the function from the Appwrite console: create a function with id
`hauz-account-provisioning`, runtime `node-22`, entrypoint `dist/main.js`, build command
`npm install && npm run build`, and upload the `functions/hauz-account-provisioning` directory.

---

## Environment variables

Every project-specific value is read at runtime. Nothing about a particular Appwrite project is
compiled into the application, so pointing it at a different project means editing `.env` and
restarting. No code changes.

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

`APP_URL` is optional because the verification link is built from the origin of the incoming request
when it is unset, which is what you want on localhost and on preview deployments. Set it when the
app sits behind a proxy that rewrites the host.

**API key scopes.** The key in `.env` is used by the application for `users.read`, `users.write` and
`sessions.write`, by `npm run setup:appwrite` for `databases.*`, `tables.*`, `columns.*`, `indexes.*`
and `rows.*`, and by `npm run preflight` for `functions.read`. They are listed per operation in
`.env.example`. The Appwrite Function does **not** use this key; it receives a scoped dynamic key
from Appwrite at execution time.

**Email delivery.** Leave `RESEND_API_KEY` and `EMAIL_FROM` empty to use Appwrite's own verification
email over your project's SMTP, which is the default and needs no configuration. Fill them in only if
the project cannot send mail, notably Appwrite Cloud's free plan, where custom SMTP is a Pro feature
and the shared sender is frequently filtered. Appwrite still mints and validates every token either
way; Resend only carries the message.

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
- **Row-level security must stay enabled** on `accounts`, `account_access_grants` and
  `personal_accounts`. The setup script enables it and re-applies it on every run. Reads depend on it.
- **Verification emails are limited to one per account per 60 seconds,** enforced on the server from
  a timestamp on the Auth user, not by the countdown in the page.
- **`getAuthState` runs on every navigation.** No Appwrite call at all without a session cookie, two
  or three with one, in exchange for a session that is always freshly confirmed rather than cached in
  the browser. A larger application would cache it with a short TTL.
- **Email delivery is pluggable; verification is not.** The Resend transport exists only because
  Appwrite Cloud's free plan cannot send reliably. Appwrite still mints and validates every token, and
  the verified flag lives where it belongs, on the Appwrite Auth user.

---

## Troubleshooting

**Anything at all** — run `npm run preflight` first. It reports which setup steps are still
outstanding and prints the command that fixes each one.

| Symptom                                            | Cause                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Every page shows "Something went wrong"            | Appwrite unreachable or the wrong project. The server log names the failure; "Start again" clears the cookie                   |
| `Invalid url param: URL host must be one of…`      | The app's hostname is not registered as a Web platform in the Appwrite console                                                 |
| Registration fails with a table not found          | `APPWRITE_DATABASE_ID` is not `hauz` and the function variable was not set (step 7)                                            |
| Function returns `role_not_found`                  | `personal_roles` has not been seeded — run `npm run setup:appwrite`                                                            |
| Function returns `unauthenticated`                 | The function's _Execute access_ does not include `users`                                                                       |
| Dashboard says "finish setting up" despite records | The visitor's own session cannot read its rows: row security was switched off on a table. `npm run setup:appwrite` restores it |
| Verification email never arrives                   | Check the active transport with `npm run preflight`; on `resend` the shared sender only delivers to your own Resend address    |
| "Invalid server environment"                       | A variable in `.env` is missing or malformed. The message names each offending key                                             |
| `project_not_found` in the server log              | `APPWRITE_PROJECT_ID` or `APPWRITE_ENDPOINT` is wrong (Cloud endpoints are region-specific)                                    |

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
