// One client per level of authority. All three are built on the server, per
// request; the browser only ever holds an httpOnly cookie with the session
// secret.
import { Account, Client, Functions, TablesDB, Users } from 'node-appwrite'

import { env } from '../env.server'

function baseClient(): Client {
  const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } = env()
  return new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID)
}

/**
 * API key. Only for what cannot be done as the person themselves: creating the
 * Auth user, opening a session, and the verification token exchange.
 *
 * No `TablesDB` here on purpose. HAUZ rows are written by the provisioning
 * Function and read with the visitor's own session, so this client has no
 * business reaching them.
 */
export function adminClient() {
  const client = baseClient().setKey(env().APPWRITE_API_KEY)
  return {
    client,
    account: new Account(client),
    users: new Users(client),
  }
}

/** Acts as the signed-in person, so Appwrite enforces row permissions for us. */
export function sessionClient(sessionSecret: string) {
  const client = baseClient().setSession(sessionSecret)
  return {
    client,
    account: new Account(client),
    tablesDB: new TablesDB(client),
  }
}

/** Short-lived JWT, so the Function gets a trustworthy `x-appwrite-user-id`. */
export function jwtClient(jwt: string) {
  const client = baseClient().setJWT(jwt)
  return {
    client,
    functions: new Functions(client),
  }
}
