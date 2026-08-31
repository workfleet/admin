// Browser-side error reporting. See lib/sentryOptions.js for what is and is
// not sent - this app holds NI numbers and ID photos, so that file matters.
//
// Named instrumentation-client.js rather than sentry.client.config.js because
// the latter is deprecated and stops working under Turbopack. Next.js only
// treats this filename as a convention from 15.3 onward, but that is not what
// loads it here: @sentry/nextjs' own webpack config finds and injects it into
// the client bundle, which works on 14.2.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentryOptions';

Sentry.init(sentryOptions);

// Reports errors thrown during a client-side navigation. Next calls this from
// 15.3 onward; on 14.2 it is simply unused, and costs nothing to leave ready.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
