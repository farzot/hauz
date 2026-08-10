/**
 * Email verification, start to finish, and all of it Appwrite's: Appwrite mints
 * the token, renders the message, sends it over the project's SMTP, validates
 * the secret when the link comes back, and owns the `emailVerification` flag
 * that results. Nothing here invents a token or keeps verification state of its
 * own.
 *
 * The one thing this module adds is a timestamp on the Auth user, so the resend
 * interval survives a restart and holds across instances.
 */
import { USER_PREF_KEYS } from '../../../shared/hauz-schema'
import { adminClient, sessionClient } from '../appwrite/clients.server'
import { describeForLog } from '../appwrite/errors.server'

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

export type SendVerificationArgs = {
  /** The send acts as the signed-in person, which is the only way Appwrite
   * allows it. */
  sessionSecret: string
  userId: string
  /** Absolute URL of the `/verify` route on this deployment. Appwrite refuses a
   * hostname that is not a registered Web platform, which is what keeps the
   * link from being turned into an open redirect. */
  returnUrl: string
  /**
   * The Auth user's current preferences. Appwrite rewrites preferences
   * wholesale, so the send timestamp has to be merged into what is already
   * there; dropping the stored profile would break the recovery path.
   */
  prefs: Record<string, unknown>
}

/** The timestamp is written only after a successful send, so a failed attempt
 * can be retried immediately instead of starting a pointless wait. */
export async function sendVerificationEmail(args: SendVerificationArgs): Promise<void> {
  await sessionClient(args.sessionSecret).account.createEmailVerification({ url: args.returnUrl })
  await recordSent(args)
}

/**
 * A failure here is swallowed: the email has already gone out, and reporting
 * failure now would claim nothing was sent when something was. The cost is at
 * most one extra email inside the interval.
 */
async function recordSent(args: SendVerificationArgs): Promise<void> {
  try {
    await adminClient().users.updatePrefs({
      userId: args.userId,
      prefs: {
        ...args.prefs,
        [USER_PREF_KEYS.verificationSentAt]: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error(`[email] could not record the send time: ${describeForLog(error)}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Confirming                                                                  */
/* -------------------------------------------------------------------------- */

export type ConfirmVerificationArgs = {
  userId: string
  secret: string
  /** The caller's existing session, when there is one. */
  sessionSecret?: string
}

/**
 * Exchanges the secret from the link for a verified address.
 *
 * Note this is `Account.updateEmailVerification` — confirming with the emailed
 * secret — not the `Users` call that would set the flag administratively.
 *
 * With a session this is the whole story. Without one — a link opened on another
 * device, or in a mail client's own viewer — Appwrite Cloud 1.9 refuses an
 * API-key caller on every `/account` endpoint (`general_unauthorized_scope`,
 * missing scope "account"), so the attempt cannot succeed there. It is still
 * made, because a self-hosted or later deployment may allow it and refusing a
 * link that would have worked is worse. When it is refused, the caller asks the
 * person to sign in and returns them to the link with its parameters intact.
 */
export async function confirmVerification(args: ConfirmVerificationArgs): Promise<void> {
  const account = args.sessionSecret
    ? sessionClient(args.sessionSecret).account
    : adminClient().account

  await account.updateEmailVerification({ userId: args.userId, secret: args.secret })
}
