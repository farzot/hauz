/**
 * Two delivery transports, one outcome: `emailVerification` true on the Auth
 * user, and only after the person proved they got the message.
 *
 *   appwrite  Appwrite mints the token, renders the email and sends it over the
 *             project's SMTP. The default.
 *   resend    Appwrite still mints and validates the token; we only carry it.
 *             For projects that cannot send mail themselves, such as Appwrite
 *             Cloud's free plan.
 *
 * The resend path does not invent a token: it asks Appwrite for one and later
 * exchanges it, so expiry, single use and validity stay Appwrite's business.
 */
import { USER_PREF_KEYS } from '../../../shared/hauz-schema'
import { adminClient, sessionClient } from '../appwrite/clients.server'
import { describeForLog } from '../appwrite/errors.server'
import { env } from '../env.server'

/** Which transport produced the link. */
export type VerificationFlow = 'appwrite' | 'token'

/** Appwrite enforces this. */
const TOKEN_LIFETIME_SECONDS = 60 * 60 * 24

const TOKEN_LENGTH = 48

/** `EMAIL_TRANSPORT` wins; otherwise a Resend key decides. */
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
   * send timestamp merged in, so the caller has to pass them.
   */
  prefs: Record<string, unknown>
}

/** The timestamp is written only after a successful send, so a failed attempt
 * can be retried immediately instead of starting a pointless wait. */
export async function sendVerificationEmail(args: SendVerificationArgs): Promise<void> {
  if (emailTransport() === 'appwrite') {
    await sessionClient(args.sessionSecret).account.createEmailVerification({ url: args.returnUrl })
  } else {
    await sendViaResend(args)
  }

  await recordSent(args)
}

/**
 * Appwrite replaces preferences wholesale, so the existing values are merged
 * back in, because dropping the stored profile would break the recovery path.
 * A failure is swallowed: the email has already gone out, and failing now would
 * claim nothing was sent when something was.
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
    // The env schema rejects this combination at startup.
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
    // Resend puts the reason in the body. It belongs in the log, not the UI.
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
  /** Set by the token flow, which signs the person in as it verifies — that is
   * what makes a link opened on a second device work without a login. */
  session?: { secret: string; expiresAt: string }
}

export async function confirmVerification(
  args: ConfirmVerificationArgs,
): Promise<ConfirmVerificationResult> {
  if (args.flow === 'token') return confirmTokenFlow(args)

  // Appwrite accepts the userId/secret pair without a session, so a link opened
  // in another browser still works. Note this is Account.updateEmailVerification
  // (confirm with the emailed secret), not the Users one below, which sets the
  // flag administratively.
  const account = args.sessionSecret
    ? sessionClient(args.sessionSecret).account
    : adminClient().account
  await account.updateEmailVerification({ userId: args.userId, secret: args.secret })
  return {}
}

async function confirmTokenFlow(args: ConfirmVerificationArgs): Promise<ConfirmVerificationResult> {
  const { account, users } = adminClient()

  // Exchanging the token is the proof of delivery: Appwrite rejects an expired,
  // altered or already-used secret.
  const session = await account.createSession({ userId: args.userId, secret: args.secret })

  try {
    await users.updateEmailVerification({ userId: args.userId, emailVerification: true })
  } catch (error) {
    // The session is valid, so they land back on the verification page where
    // resending costs one click.
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
  // Inline styles, no tables: survives every mail client.
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
