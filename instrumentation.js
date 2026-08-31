import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Server-side errors thrown while rendering a route. Without this, a failing
// page renders the error boundary and nothing is ever reported.
export const onRequestError = Sentry.captureRequestError;
