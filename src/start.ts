import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

/**
 * Application-wide server configuration.
 *
 * ## CSRF
 *
 * Every mutation in this application is a server function reached by POST,
 * authorised by a cookie. That is the exact shape a cross-site request forgery
 * exploits: a page on another origin submits to our endpoint, the browser
 * attaches our cookie, and the request succeeds.
 *
 * `SameSite=Lax` on the session cookie already blocks the classic version of
 * that attack, because browsers do not attach a Lax cookie to a cross-site
 * POST. This middleware is the second lock: it verifies the request actually
 * originated from this application, using `Sec-Fetch-Site` and falling back to
 * `Origin`, then `Referer`. A request carrying none of the three is refused
 * rather than assumed innocent.
 *
 * Two locks rather than one because the first depends entirely on browser
 * behaviour — cookie policy defaults have moved before, and a proxy or a client
 * that mishandles SameSite would silently remove the only protection.
 *
 * ## Why only mutations
 *
 * The check is scoped to methods that change state. Applying it to every
 * request would reject ordinary cross-site navigation — including the
 * verification link in the email, which arrives from a mail client as
 * `Sec-Fetch-Site: cross-site` and must be allowed to open the page.
 *
 * Reads are left alone deliberately. `getAuthState` is a GET server function
 * returning JSON; a cross-origin caller can cause it to run but cannot read the
 * response without a CORS grant, which is not given.
 */
const csrf = createCsrfMiddleware({
  filter: ({ request }) => request.method !== 'GET' && request.method !== 'HEAD',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf],
}))
