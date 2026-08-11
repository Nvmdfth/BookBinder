# BookBinder end-to-end suite

Playwright specs driving the full stack — Postgres, Express, and the built SPA —
in a real browser. This is the layer below `frontend/` (Vitest + jsdom) and
`backend/` (Jest + supertest): it exists for the bugs neither of those can see,
where the browser, the network, and the server all have to agree.

## Running

```sh
cd e2e
npm install
npx playwright install chromium   # once
npm test
```

The suite builds and boots its own stack, then tears it down. First run takes a
couple of minutes for the image build; after that it is ~35s.

| Command | Effect |
| --- | --- |
| `npm test` | Full run against a freshly built stack |
| `npm run test:headed` | Same, with a visible browser |
| `npm run test:ui` | Playwright's interactive runner |
| `npm run tour` | Design tour — screenshots every screen and state |
| `npm run report` | Open the HTML report from the last run |
| `npm run stack:down` | Force-remove the stack if a run was interrupted |

Environment switches:

| Variable | Purpose |
| --- | --- |
| `E2E_HOST` | Override the host address (see below) |
| `E2E_PORT` | Published port, default `5100` |
| `E2E_REUSE_STACK=1` | Skip rebuild, reuse the running stack — fast spec iteration |
| `E2E_KEEP_STACK=1` | Leave the stack up after the run for inspection |

## Two decisions worth knowing about

**It runs against a LAN address, not localhost.** Browsers treat `localhost`,
`127.0.0.0/8` and `::1` as trustworthy origins, so a `Secure` cookie is accepted
over plain HTTP there. Every cookie-transport bug in this app's history has been
invisible on loopback and only reproduced on the address a phone or laptop
actually browses to. `lib/lanHost.js` picks a private IPv4 on a physical
adapter, skipping WSL and Hyper-V switches; set `E2E_HOST` if it guesses wrong.

**It runs the production container, not `vite dev`.** Cookie attributes, SPA
catch-all routing, and static asset serving all behave differently under the dev
server, so testing that would be testing a different application. The stack runs
under project name `bookbinder-e2e` with its own volumes, so it cannot touch a
development stack running alongside it.

## Layout

```
playwright.config.js   Config; baseURL resolved from the LAN address
global-setup.js        Builds and boots the stack, waits on /api/health
global-teardown.js     Removes the stack and its volumes
docker-compose.e2e.yml Overrides layered on ../docker-compose.yml
lib/lanHost.js         Host address resolution
lib/stack.js           Compose lifecycle and health polling
lib/accounts.js        Registers accounts and signs in through the real form
tests/                 Specs
```

## Writing a spec

Specs share one database and run serially. Isolation comes from
`createAccount()`, which registers a uniquely-addressed user per test — open
registration ships disabled, so it flips the admin switch on once per run first.

```js
const { createAccount, signIn } = require('../lib/accounts');

const account = await createAccount('mylabel');
await signIn(page, account);
```

**Verify a regression guard actually fails.** Reintroduce the bug, watch the
spec go red, then restore the fix. An e2e test that was never seen failing is
not evidence of anything — the first draft of `password-change-session.spec.js`
had a cookie assertion that passed against the very bug it was written for,
because the browser had silently kept the pre-change cookie and the assertion
could not tell the two apart.

## The design tour

`npm run tour` boots the stack, seeds a realistic catalogue, and walks the app
capturing every screen, overlay and interaction state to `tour/shots/`. It also
runs a contrast audit over the rendered pages and prints anything below AA.

It is a **reviewing tool, not a test**. It asserts almost nothing and cannot
fail a build; it lives outside `tests/` so `playwright test` will not collect
it. Its job is to make visual state inspectable in one command, because the
problems it exists to surface — a field that reads as disabled, a red zero
sitting beside a green all-clear — are invisible to assertions that only check
behaviour.

The contrast audit complements `frontend/src/tests/themeContrast.test.js`
rather than duplicating it. That test checks the palette *tokens*, which is the
right place for it. It cannot see a colour applied inline to a single element,
which is exactly how "Sign Out" sat at 2.8:1 while every token in the
stylesheet was compliant. The audit walks the rendered page instead.

Two things worth knowing when reading its output:

- **Seed enough content.** A design review of an app holding three books
  reviews the wrong app. An early pass reported that the cover grid stranded
  most of a 1440px screen; with a realistic ten-book shelf the row fills
  normally. The fixture exists to avoid that class of false finding.
- **Full-page screenshots lie about fixed elements.** A `fullPage` capture
  places a `position: fixed` element at its viewport offset, which strands the
  mobile bottom tray in the middle of the document and looks like a layout bug.
  The phone pass captures viewport-sized shots for this reason.

## Known gap: the barcode scanner

`BarcodeScanner.jsx` is not covered here. `html5-qrcode` negotiates its own
`getUserMedia` stream, and Chromium's fake-camera flags do not drive it
reliably. Scanner behaviour is best checked against a real camera — the
`claude-in-chrome` skill drives an actual Chrome session and can do this.
`frontend/src/tests/scannerTeardown.test.jsx` covers the teardown contract at
the unit level in the meantime.
