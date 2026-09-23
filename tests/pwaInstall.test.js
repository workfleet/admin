import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isSamsungInternet, chromeIntentUrl } from '../lib/pwaInstall';
import InstallPrompt from '../app/components/InstallPrompt';
import InstallSteps from '../app/components/InstallSteps';

// Samsung Internet is Chromium: it fires `beforeinstallprompt` and there is
// nothing in the page to tell it apart from Chrome. Install from it anyway and
// Android 14+ blocks the WebAPK it mints as unsafe, which is what a cleaner
// sees - a security warning, on the app her employer told her to install. The
// user-agent string is the only signal we get, so it is worth pinning.

const SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const EDGE_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.0.0';

describe('isSamsungInternet', () => {
  it('spots Samsung Internet', () => {
    expect(isSamsungInternet(SAMSUNG)).toBe(true);
  });

  it('does not mistake Chrome for it', () => {
    // Samsung Internet's UA contains "Chrome/125..." too, so a naive check on
    // the other side of this would send every Chrome user to Chrome.
    expect(isSamsungInternet(CHROME_ANDROID)).toBe(false);
  });

  it('leaves iOS and other Chromium browsers alone', () => {
    expect(isSamsungInternet(IOS_SAFARI)).toBe(false);
    expect(isSamsungInternet(EDGE_ANDROID)).toBe(false);
  });
});

// Both components decide what to show from `window` and `navigator`, neither
// of which exists on the server. Anything that reads them during render rather
// than in an effect takes the whole page down, and a build would not notice -
// the install bar sits inside the cleaner layout, so that is every cleaner
// page at once.
describe('server render', () => {
  it('renders the install bar to nothing without touching window', () => {
    expect(renderToStaticMarkup(createElement(InstallPrompt))).toBe('');
  });

  it('renders the onboarding steps to nothing without touching window', () => {
    expect(renderToStaticMarkup(createElement(InstallSteps))).toBe('');
  });
});

describe('chromeIntentUrl', () => {
  const url = 'https://crewconnect-cleaning.vercel.app/cleaner';

  it('addresses the intent to Chrome by package name', () => {
    const intent = chromeIntentUrl(url);
    expect(intent.startsWith('intent://crewconnect-cleaning.vercel.app/cleaner#Intent;')).toBe(true);
    expect(intent).toContain('scheme=https;');
    expect(intent).toContain('package=com.android.chrome;');
    expect(intent.endsWith(';end')).toBe(true);
  });

  it('carries a fallback so a phone without Chrome lands back on the page', () => {
    expect(chromeIntentUrl(url)).toContain(
      `S.browser_fallback_url=${encodeURIComponent(url)}`,
    );
  });

  it('keeps the query string, which carries the page they were on', () => {
    expect(chromeIntentUrl(`${url}/jobs?day=2026-09-23`)).toContain('/cleaner/jobs?day=2026-09-23#Intent;');
  });

  it('drops the fragment rather than passing our own #Intent through it', () => {
    // A fragment in the source URL would collide with the intent's own, and
    // the whole handoff would fail to parse on the phone.
    expect(chromeIntentUrl(`${url}#photos`)).not.toContain('#photos#Intent');
  });
});
