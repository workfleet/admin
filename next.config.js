const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A production build and `next dev` both write to `.next`, so running one
  // while the other is up corrupts the build ("Cannot find module './4894.js'"
  // during page-data collection). Two sessions in this checkout is normal now,
  // so this leaves a way to build somewhere else: NEXT_DIST_DIR=.next-build.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Android fetches the site's app-association file from a fixed path it will
  // not negotiate on. `.well-known` is a hidden directory as far as the App
  // Router is concerned, so the handler lives at a routable path and this puts
  // it back where Google looks. See lib/assetlinks.js.
  async rewrites() {
    return [
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    ];
  },
};

// Source map upload needs a Sentry auth token, and nobody should have to hold
// one to build this app - a contributor without it, or a CI job that only
// checks the build compiles, gets a normal build and unminified stack traces
// only in environments where the token is set.
const hasSentryAuth = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet unless something is actually wrong; the build log is read for build
  // problems, not for upload chatter.
  silent: true,
  sourcemaps: { disable: !hasSentryAuth },

  // Route the browser SDK through the app's own domain, so an ad blocker or a
  // corporate network filtering Sentry's domain does not silently drop every
  // report from exactly the sites most likely to have problems.
  tunnelRoute: '/monitoring',

  // Strips Sentry's own console logging out of the production bundle.
  webpack: { treeshake: { removeDebugLogging: true } },
});
