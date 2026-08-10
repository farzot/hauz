/**
 * Email verification, with a swappable delivery mechanism.
 *
 * Two transports, same outcome — `emailVerification` true on the Appwrite Auth
 * user, and only after the person proved they received the message:
 *
 *   appwrite  Appwrite mints the token, renders the email and delivers it over
 *             the project's SMTP. The canonical path, and the default.
 *
 *   resend    Appwrite still mints and validates the token; this application
 *             only carries it. Used where the project cannot send mail itself —
 *             Appwrite Cloud's free plan does not allow a custom SMTP server,
 *             and its shared sender is rate-limited and frequently filtered.
 *
 * The `resend` transport deliberately does not invent its own token. It asks
 * Appwrite for one (`users.createToken`), mails it, and later exchanges it
 * (`account.createSession`). Appwrite therefore remains the authority on
 * expiry, single use and validity, and the verification flag is set only once
 * Appwrite has accepted the secret.
 */
import { USER_PREF_KEYS } from '../../../shared/hauz-schema'
import { adminClient, sessionClient } from '../appwrite/clients.server'
import { describeForLog } from '../appwrite/errors'
import { env } from '../env.server'

/** Which half of the link belongs to which transport. */
export type VerificationFlow = 'appwrite' | 'token'

/** How long a `resend` verification link stays usable. Appwrite enforces it. */
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 // 24 hours

/** Long enough that guessing is hopeless; Appwrite generates the value. */
const TOKEN_LENGTH = 48

/**
 * The transport in use. Explicit `EMAIL_TRANSPORT` wins; otherwise the presence
 * of a Resend key decides, so a project with working SMTP needs no extra
 * configuration at all.
 */
export function emailTransport(): 'appwrite' | 'resend' {
  const { EMAIL_TRANSPORT, RESEND_API_KEY } = env()
  if (EMAIL_TRANSPORT) return EMAIL_TRANSPORT
  return RESEND_API_KEY ? 'resend' : 'appwrite'
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

export type SendVerificationArgs = {
  /** Needed by the `appwrite` transport, which acts as the signed-in person. */
  sessionSecret: string
  userId: string
  email: string
  /** Used to address the message; may be empty. */
  name: string
  /** Absolute URL of the `/verify` route on this deployment. */
  returnUrl: string
  /**
   * The Auth user's current preferences. They are rewritten wholesale with the
   * send timestamp merged in, so they have to be passed rather than guessed.
   */
  prefs: Record<string, unknown>
}

/**
 * Sends the verification email and records when it went out.
 *
 * The timestamp is written only after a successful send, so a failed attempt
 * can be retried immediately rather than starting a pointless wait.
 */
export async function sendVerificationEmail(args: SendVerificationArgs): Promise<void> {
  if (emailTransport() === 'appwrite') {
    await sessionClient(args.sessionSecret).account.createVerification({ url: args.returnUrl })
  } else {
    await sendViaResend(args)
  }

  await recordSent(args)
}

/**
 * Stores the send time on the Auth user.
 *
 * Appwrite replaces preferences wholesale, so the existing values are merged
 * back in: losing the stored profile here would break the recovery path that
 * `/complete-registration` depends on.
 *
 * A failure is logged and swallowed. The email has already gone out, and
 * refusing the whole request at this point would tell the person that nothing
 * was sent when something was.
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

async function sendViaResend(args: SendVerificationArgs): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env()
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    // Unreachable: the environment schema rejects this combination at startup.
    throw new Error('The resend transport needs RESEND_API_KEY and EMAIL_FROM.')
  }

  const token = await adminClient().users.createToken({
    userId: args.userId,
    length: TOKEN_LENGTH,
    expire: TOKEN_LIFETIME_SECONDS,
  })

  const link = new URL(args.returnUrl)
  link.searchParams.set('userId', args.userId)
  link.searchParams.set('secret', token.secret)
  link.searchParams.set('flow', 'token' satisfies VerificationFlow)

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [args.email],
      subject: 'Confirm your email address',
      text: verificationText(args.name, link.toString()),
      html: verificationHtml(args.name, link.toString()),
    }),
  })

  if (!response.ok) {
    // Resend puts the reason in the body; it belongs in the log, not the browser.
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 500)}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Confirming                                                                  */
/* -------------------------------------------------------------------------- */

export type ConfirmVerificationArgs = {
  userId: string
  secret: string
  flow: VerificationFlow
  /** The caller's existing session, when there is one. */
  sessionSecret?: string
}

export type ConfirmVerificationResult = {
  /**
   * Set when confirming produced a session — the `token` flow signs the person
   * in as a side effect, which is what makes a link opened on a second device
   * work without a separate login.
   */
  session?: { secret: string; expiresAt: string }
}

export async function confirmVerification(
  args: ConfirmVerificationArgs,
): Promise<ConfirmVerificationResult> {
  if (args.flow === 'token') return confirmTokenFlow(args)

  // Appwrite's own flow. It accepts the userId/secret pair without a session,
  // so a link opened in another browser still works; an existing session is
  // used when there is one.
  const account = args.sessionSecret
    ? sessionClient(args.sessionSecret).account
    : adminClient().account
  await account.updateVerification({ userId: args.userId, secret: args.secret })
  return {}
}

async function confirmTokenFlow(args: ConfirmVerificationArgs): Promise<ConfirmVerificationResult> {
  const { account, users } = adminClient()

  // Exchanging the token is the proof of delivery: Appwrite rejects an expired,
  // altered or already-used secret. Nothing is marked verified before this.
  const session = await account.createSession({ userId: args.userId, secret: args.secret })

  try {
    await users.updateEmailVerification({ userId: args.userId, emailVerification: true })
  } catch (error) {
    // The session is valid, so the person is signed in and lands back on the
    // verification page, where resending costs one click.
    console.error(`[email] token accepted but the flag did not stick: ${describeForLog(error)}`)
    throw error
  }

  return { session: { secret: session.secret, expiresAt: session.expire } }
}

/* -------------------------------------------------------------------------- */
/* Message body                                                                */
/* -------------------------------------------------------------------------- */

function greeting(name: string): string {
  const firstName = name.trim().split(/\s+/)[0]
  return firstName ? `Hi ${firstName},` : 'Hi,'
}

function verificationText(name: string, link: string): string {
  return [
    greeting(name),
    '',
    'Confirm your email address to finish setting up your HAUZ account:',
    link,
    '',
    'The link is valid for 24 hours.',
    'If you did not create a HAUZ account, you can ignore this message.',
  ].join('\n')
}

function verificationHtml(name: string, link: string): string {
  // Deliberately plain: inline styles and a table-free layout survive every
  // mail client, and there is nothing here worth a rendering bug.
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;">Confirm your email address</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;">${escapeHtml(greeting(name))}</p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
        Confirm this address to finish setting up your HAUZ account.
      </p>
      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;font-weight:600;">
        Confirm email address
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
        The link is valid for 24 hours. If the button does not work, copy this address into your browser:
      </p>
      <p style="margin:8px 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:#64748b;">
        ${escapeHtml(link)}
      </p>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748b;">
        If you did not create a HAUZ account, you can ignore this message.
      </p>
    </div>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
