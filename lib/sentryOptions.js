// Shared Sentry setup for the browser, the server and the edge runtime.
//
// Two things matter more here than in a typical app.
//
// First, this stays inert until somebody sets a DSN. With no DSN the SDK
// initialises and sends nothing, so the app builds and runs exactly as it does
// today whether or not error reporting has been turned on yet - no crash on a
// missing env var, no half-configured state.
//
// Second, and the reason this file exists rather than three copies of an
// options object: this database holds National Insurance numbers, dates of
// birth, home addresses and ID document photos. An error reporter that
// helpfully attaches request bodies and form state would quietly ship all of
// that to a third-party service, which is a data breach rather than a
// debugging aid. Everything below is set with that in mind, and any future
// change to these options needs the same thought.

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || '';

// Query strings on this app's URLs carry ids, and the onboarding flow's URLs
// carry an invite token that is the credential for creating an account. None
// of that belongs in an error report.
function scrubUrl(url) {
  if (typeof url !== 'string') return url;
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');
    // /onboard/<token> and /api/onboarding/<token>/... - the token is the
    // whole security of that flow, so it never leaves the app.
    const path = parsed.pathname
      .replace(/\/onboard\/[^/]+/, '/onboard/[token]')
      .replace(/\/api\/onboarding\/[^/]+/, '/api/onboarding/[token]');
    return parsed.search ? `${path}?[redacted]` : path;
  } catch {
    return url;
  }
}

export const sentryOptions = {
  dsn: SENTRY_DSN,

  // Never attach cookies, headers, IP addresses or user identifiers by
  // default. Sentry's own docs describe this as opt-in; for this app it stays
  // off, because "who was logged in" is not worth the personal data.
  sendDefaultPii: false,

  // Enough tracing to see a slow page without sampling every request into the
  // free tier's monthly quota.
  tracesSampleRate: 0.1,

  // Session Replay is deliberately NOT enabled. It records the rendered page,
  // and the pages worth debugging most - onboarding, a cleaner's profile, the
  // admin's view of an ID document - are exactly the ones showing someone's
  // NI number and address.

  // Noise that says nothing about this app: a cleaner losing signal in a
  // basement, or an extension throwing inside its own script.
  ignoreErrors: [
    'Failed to fetch',
    'NetworkError when attempting to fetch resource',
    'Load failed',
    'AbortError',
    'ResizeObserver loop completed with undelivered notifications',
  ],

  beforeSend(event) {
    if (event.request) {
      // Form submissions carry everything the onboarding flow collects.
      delete event.request.data;
      delete event.request.cookies;
      delete event.request.headers;
      if (event.request.url) event.request.url = scrubUrl(event.request.url);
      if (event.request.query_string) event.request.query_string = '[redacted]';
    }
    // Breadcrumbs record navigations, which carry the same tokens and ids.
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => {
        if (crumb?.data?.url) return { ...crumb, data: { ...crumb.data, url: scrubUrl(crumb.data.url) } };
        return crumb;
      });
    }
    return event;
  },
};
