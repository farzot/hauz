// Every project-specific value is read from the environment, so pointing the
// app at a different Appwrite project means editing .env and restarting. Table
// ids are the exception: they are schema, not configuration, and live in
// shared/hauz-schema.ts.
import { z } from 'zod'

const envSchema = z
  .object({
    APPWRITE_ENDPOINT: z.url({
      error: 'APPWRITE_ENDPOINT must be a URL, for example https://cloud.appwrite.io/v1',
    }),
    APPWRITE_PROJECT_ID: z.string().min(1),
    /** Never sent to the browser, and never used by the Appwrite Function. */
    APPWRITE_API_KEY: z.string().min(1),
    APPWRITE_DATABASE_ID: z.string().min(1).default('hauz'),
    APPWRITE_PROVISIONING_FUNCTION_ID: z.string().min(1).default('hauz-account-provisioning'),
    /** Origin for the verification link. Unset means "use the request origin",
     * which keeps localhost and preview deployments working unconfigured. */
    APP_URL: z.url().optional(),
    SESSION_COOKIE_NAME: z.string().min(1).default('hauz_session'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    /** Leave unset for Appwrite's own SMTP. Set `resend`, or just provide
     * RESEND_API_KEY, where the project cannot send mail itself. */
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
 * A key left blank in .env (`RESEND_API_KEY=`) arrives as an empty string,
 * which is never what that line means. Dropping empty values makes it behave as
 * "not set", so defaults still apply.
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
    // Fail loudly here rather than with a confusing Appwrite error later.
    throw new Error(`Invalid server environment.\n${details}\n\nSee .env.example.`)
  }

  cached = parsed.data
  return cached
}

export const isProduction = () => env().NODE_ENV === 'production'
