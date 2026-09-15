import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The app's components are JSX in plain .js files, which Vite's transform
  // only expects in .jsx. Reading app/ files as JSX lets a test render a
  // component to a string - the one check that catches a crash on render,
  // which neither the build nor the helper tests can. Vite's own default
  // excludes every .js file, so the exclude has to be set as well.
  oxc: {
    include: /app\/.*\.js$/,
    exclude: /node_modules/,
    lang: 'jsx',
    jsx: { runtime: 'automatic' },
  },
  test: {
    // Every module under test is pure arithmetic or date handling, or a
    // component rendered to a string - none of them touch a DOM, so there
    // is no reason to pay for jsdom.
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
