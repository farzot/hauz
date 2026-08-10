/**
 * Server-side configuration.
 *
 * Every project-specific value is read from the environment. Nothing about a
 * particular Appwrite project is compiled into the application, so pointing it
 * at a different project is a matter of changing `.env` and restarting.
 *
 * Table ids are the one exception: they are part of the supplied schema rather
 * than deployment configuration, so they live in `shared/hauz-schema.ts`.
 */
import { z } from 'zod'

const envSchema = z
  .object({
    APPWRITE_ENDPOINT: z.url({
      error: 'APPWRITE_ENDPOINT must be a URL, for example https://cloud.appwrite.io/v1',
    }),
    APPWRITE_PROJECT_ID: z.string().min(1),
    /** Server-only. Never sent to the browser and never used by the Appwrite Function. */
    APPWRITE_API_KEY: z.string().min(1),
    APPWRITE_DATABASE_ID: z.string().min(1).default('hauz'),
    APPWRITE_PROVISIONING_FUNCTION_ID: z.string().min(1).default('hauz-account-provisioning'),
    /**
     * Public origin used to build the email-verification link. Optional: when it
     * is unset the origin of the incoming request is used, which keeps local
     * development and preview deployments working without configuration.
     */
    APP_URL: z.url().optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default('hauz_session'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    /**
     * How the verification email is delivered. Leave unset to let Appwrite send
     * it over the project's own SMTP, which is the canonical path. Set `resend`
     * — or simply provide `RESEND_API_KEY` — where the project cannot send mail
     * itself; see src/lib/email/verification.server.ts.
     */
    EMAIL_TRANSPORT: z.enum(['appwrite', 'resend']).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** RFC 5322 sender, for example `HAUZ <onboarding@resend.dev>`. */
    EMAIL_FROM: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const usesResend = value.EMAIL_TRANSPORT === 'resend' || Boolean(value.RESEND_API_KEY)
    if (!usesResend) return

    for (const key of ['RESEND_API_KEY', 'EMAIL_FROM'] as const) {
      if (!value[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `required when the email transport is "resend"`,
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof envSchema>

let cached: ServerEnv | undefined

/**
 * A key left blank in `.env` — `RESEND_API_KEY=` — reaches the process as an
 * empty string, which is not what anyone writing that line means. Dropping
 * empty values makes a blank line behave as "not set", so optional settings
 * stay optional and defaults still apply.
 */
function presentEnvValues(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
    ),
  )
}

export function env(): ServerEnv {
  if (cached) return cached

  const parsed = envSchema.safeParse(presentEnvValues())
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    // Fail loudly at first use rather than producing confusing Appwrite errors later.
    throw new Error(`Invalid server environment.\n${details}\n\nSee .env.example.`)
  }

  cached = parsed.data
  return cached
}

export const isProduction = () => env().NODE_ENV === 'production'
