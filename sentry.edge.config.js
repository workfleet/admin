// Edge runtime (middleware and any edge route). Nothing here uses it today,
// but Next warns if the runtime is left uninstrumented once the SDK is on.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentryOptions';

Sentry.init(sentryOptions);
