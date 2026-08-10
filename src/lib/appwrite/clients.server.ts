/**
 * Appwrite clients, one per level of authority.
 *
 * The application never talks to Appwrite from the browser. All three clients
 * are built on the server, per request, and the only thing that ever reaches
 * the browser is an httpOnly cookie holding the Appwrite session secret.
 *
 *   adminClient   — API key. Used strictly for the two operations that cannot
 *                   have a session yet: creating an Auth user and creating an
 *                   email/password session.
 *   sessionClient — acts as the signed-in person. Everything Appwrite can
 *                   authorise for a user goes through this one, so row-level
 *                   permissions are enforced by Appwrite rather than by us.
 *   jwtClient     — acts as the signed-in person against the Functions API, so
 *                   the Function receives a trustworthy `x-appwrite-user-id`.
 */
import { Account, Client, Functions, TablesDB, Users } from 'node-appwrite'

import { env } from '../env.server'

function baseClient(): Client {
  const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID } = env()
  return new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID)
}

/** Full project authority. Keep its use to a minimum and never per user request. */
export function adminClient() {
  const client = baseClient().setKey(env().APPWRITE_API_KEY)
  return {
    client,
    account: new Account(client),
    users: new Users(client),
    tablesDB: new TablesDB(client),
  }
}

/** Scoped to one person's session secret. */
export function sessionClient(sessionSecret: string) {
  const client = baseClient().setSession(sessionSecret)
  return {
    client,
    account: new Account(client),
    tablesDB: new TablesDB(client),
  }
}

/** Scoped to one person via a short-lived JWT. */
export function jwtClient(jwt: string) {
  const client = baseClient().setJWT(jwt)
  return {
    client,
    functions: new Functions(client),
  }
}
