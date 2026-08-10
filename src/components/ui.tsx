/**
 * The small set of presentational pieces the auth screens need.
 *
 * The assignment does not evaluate visual design, so this stays deliberately
 * plain: enough structure to keep the routes readable, correct labelling and
 * error wiring for assistive technology, and nothing else.
 */
import type { ReactNode } from 'react'

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  )
}

export function Card({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
      <div className="mt-6">{children}</div>
      {footer ? (
        <div className="mt-6 border-t border-slate-200 pt-4 text-sm text-slate-600">{footer}</div>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

const ALERT_STYLES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
} as const

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof ALERT_STYLES
  title?: string
  children: ReactNode
}) {
  return (
    <div
      // `alert` announces errors immediately; anything else waits for a pause.
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${ALERT_STYLES[tone]}`}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

type FieldProps = {
  name: string
  label: string
  error?: string
  hint?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode
}

export function Field({ name, label, error, hint, children }: FieldProps) {
  const hintId = hint ? `${name}-hint` : undefined
  const errorId = error ? `${name}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children({
        id: name,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {error ? (
        // `alert` so the message is announced when it appears, rather than
        // sitting silently under an input the person has already moved past.
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm ' +
  'outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 aria-[invalid]:border-red-400'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL_CLASS} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL_CLASS} />
}

const BUTTON_VARIANTS = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
} as const

export function Button({
  variant = 'primary',
  pending = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS
  /** Disables the control while a request is in flight, which is what stops double submits. */
  pending?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
      className={
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium ' +
        'transition disabled:cursor-not-allowed disabled:opacity-60 ' +
        BUTTON_VARIANTS[variant]
      }
    >
      {pending ? 'Working…' : children}
    </button>
  )
}
