# Putting WorkFleet on the Play Store

This is the walkthrough for turning the site into a real Android app listing —
findable by name, installed from the Play Store, updating itself, and with no
security warning in front of it.

**You probably don't need this.** WorkFleet is already a PWA: Chrome's "Add to
Home screen" gives a cleaner a standalone icon with no browser bar, updated on
every deploy, with nothing to sideload. That covers a crew of any size. The
Play Store is worth the effort only when you want staff to find the app by
searching for it, or you want an install link you can put on a job ad.

It is not a quick job. Budget a few hours of your own time spread over one to
two weeks, most of that waiting on Google.

## What the app actually is

A Trusted Web Activity: Chrome rendering this site full-screen inside an app
shell. There is no separate Android codebase, and there never will be — the
"app" is a few hundred kilobytes of wrapper pointing at the deployed site.

Chrome only drops its address bar if the site publicly agrees that the app
speaks for it. That agreement is a file at
`/.well-known/assetlinks.json`, naming the app's package name and signing
certificate. That file is already wired up here:

- [`lib/assetlinks.js`](../lib/assetlinks.js) builds and validates the document
- [`app/api/assetlinks/route.js`](../app/api/assetlinks/route.js) serves it
- [`next.config.js`](../next.config.js) rewrites `/.well-known/assetlinks.json`
  onto that route
- [`tests/assetlinks.test.js`](../tests/assetlinks.test.js) covers the shape

It reads two environment variables and serves an empty list `[]` until both are
set — which is what the live URL returns today. Nothing is claimed yet, and
that is correct.

| Variable | What goes in it |
| --- | --- |
| `ANDROID_PACKAGE_NAME` | The app's package id, e.g. `app.vercel.crewconnect_cleaning.twa` |
| `ANDROID_CERT_FINGERPRINTS` | One or more SHA-256 certificate fingerprints, separated by commas or newlines |

Neither is a secret. Both are published to anyone who fetches the URL — that is
the entire mechanism.

---

## Step 0 — settle the domain first

The assetlinks file has to be served from the exact domain the app opens. Today
that is `crewconnect-cleaning.vercel.app`. If WorkFleet moves to its own domain
later, the app has to be rebuilt and re-released to point at the new one — a
redirect will not do, because Google fetches the file without following
redirects.

If a WorkFleet domain is coming, do it before this, not after.

## Step 1 — Google Play developer account

At [play.google.com/console](https://play.google.com/console): a one-off $25
fee and identity verification. A personal account needs photo ID. A business
account needs registration documents and, in most cases, a D-U-N-S number,
which itself can take a week or more to obtain.

Start this first. Everything else is faster than the verification.

## Step 2 — build the package

[PWABuilder](https://www.pwabuilder.com) takes the site URL and produces the
Android package. Enter the site address, choose the Android/Google Play
package, and check the options before generating:

- **Package ID** — permanent. It can never be changed for this listing, so pick
  something you would still write today if you were starting fresh, e.g.
  `app.workfleet.crew`. Write it down.
- **App name** — WorkFleet.
- **Signing key** — let it generate a new one.

The download contains the `.aab` to upload, a signing keystore, and a text file
with the key's passwords and its SHA-256 fingerprint.

**Back that keystore and its passwords up somewhere you will still have them in
three years.** Lose them and you cannot ship an update to this listing —
Google's recovery process exists but is slow and not guaranteed. Put them
wherever the business keeps its other irreplaceable credentials, not only on
this laptop.

Building fresh from PWABuilder also avoids the problem that started this: the
APK Play Protect blocked was targeting an Android version too old to be
installable. A package generated today targets a current one.

## Step 3 — publish the first fingerprint

In Vercel → the project → Settings → Environment Variables, add:

- `ANDROID_PACKAGE_NAME` — the package id from step 2
- `ANDROID_CERT_FINGERPRINTS` — the SHA-256 fingerprint from the signing key

Redeploy. Vercel only picks up environment changes on a new deployment.

Then open `https://<your-domain>/.well-known/assetlinks.json` in a browser. You
should see your package name and fingerprint. If it still says `[]`, either the
redeploy has not finished or the fingerprint was rejected as malformed — it has
to be 32 hex bytes, and a truncated paste is the usual culprit.

## Step 4 — the store listing

In Play Console, create the app, then work through the tasks it lists. The ones
that take real time:

- **Privacy policy URL** — required. The app already serves one at `/privacy`.
- **Data safety form** — a declaration of what the app collects, and it needs to
  be accurate. WorkFleet collects location (clock-in geofencing), photos,
  names, contact details, bank details for payroll, and identity documents
  during onboarding. Fill this in honestly and carefully; a wrong answer here is
  a compliance problem, not a paperwork one.
- **Content rating questionnaire** — short.
- **Target audience** — adults; say the app is not directed at children.
- **Graphics** — a 512×512 icon, a 1024×500 feature graphic, and at least two
  phone screenshots. `public/icon-512.png` covers the icon.
- **App access** — WorkFleet is entirely behind a login, so Google's reviewers
  cannot see anything without one. You must give them working test credentials
  in the "App access" section or the review will be rejected. Make a real
  account for this, not a shared one.

## Step 5 — the second fingerprint (the step everyone misses)

When you upload the `.aab`, Google re-signs it with **its own** key before
delivering it to phones. So the certificate on the app a cleaner installs is not
the one from step 2, and the file from step 3 will not verify it.

In Play Console, under Test and release → Setup → App signing, there are two
SHA-256 fingerprints: the **upload key** (yours, from step 2) and the **app
signing key** (Google's). Append the app signing key one to
`ANDROID_CERT_FINGERPRINTS`, so the variable holds both, separated by a comma:

```
ANDROID_CERT_FINGERPRINTS=<upload key SHA-256>,<app signing key SHA-256>
```

Redeploy and re-check the URL — you should now see two entries.

Keeping both means a locally built copy and a Play-installed copy both verify.
Getting this wrong is the single most common reason a TWA installs fine and
then shows a Chrome address bar across the top.

## Step 6 — test on a real phone before anyone else sees it

Use an internal testing release. Add your own Google account as a tester,
install from the link Play gives you, and check:

- No address bar at the top.
- The back button behaves.
- Login works, and the session survives closing and reopening the app.
- Camera and location prompts appear and work — these are the features most
  likely to behave differently inside a TWA than in the browser.

If the address bar is there, the assetlinks file and the app disagree. Check the
package name matches exactly, check both fingerprints are present, and then
verify against Google's own checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://crewconnect-cleaning.vercel.app&relation=delegate_permission/common.handle_all_urls
```

Chrome caches the result, so after a fix, uninstall and reinstall rather than
concluding it did not work.

## Step 7 — release

Promote to production. First reviews commonly take a few days and can take
longer; later updates are usually much faster.

---

## Things worth knowing before you start

- **Updates are still instant.** The wrapper points at the live site, so
  deploying still reaches every phone immediately. You only rebuild and
  re-release the Android package when the icon, name, or package settings
  change — not for app changes.
- **Google's target SDK requirements move.** Roughly once a year, listings must
  be rebuilt against a newer Android version or they stop being served to new
  devices. That is a yearly regenerate-and-upload, not a code change, but it is
  a recurring commitment that the PWA route does not have.
- **iPhones are unaffected.** Apple has no TWA equivalent; iOS staff install the
  PWA from Safari's Share → Add to Home Screen either way. Doing this for
  Android does not give you an iPhone app, and the App Store route is a great
  deal more work than this one.
- **Never sideload an APK to a cleaner's phone.** It trains staff to tap
  through security dialogs, and every update has to be re-sent by hand.

## The Play Protect warning that started this

Worth recording, because it was not a sideload and it is not fixed by any of
the above.

Tapping Install in **Samsung Internet** produced "Unsafe app blocked — this app
was built for an older version of Android". Installing a PWA on Android does
build a real APK — a WebAPK, minted and signed by the browser's own server —
and Samsung Internet's minting server still targets an Android version that
Android 14+ refuses to install. Chrome's targets a current one. Samsung have it
open at [SamsungInternet/support#123](https://github.com/SamsungInternet/support/issues/123);
nothing in this app's manifest affects it.

The app now detects Samsung Internet (`isSamsungInternet` in
[`lib/pwaInstall.js`](../lib/pwaInstall.js)) and offers a handoff to Chrome
instead of an Install button that can only end at that dialog. Staff on Samsung
phones — which is most of them — need to install from Chrome.
