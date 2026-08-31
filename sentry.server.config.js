// Node runtime: the /api routes, which is where a failure is most likely to
// be invisible today - a quote PDF that never generates, a notification email
// that silently does not send.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentryOptions';

Sentry.init(sentryOptions);
