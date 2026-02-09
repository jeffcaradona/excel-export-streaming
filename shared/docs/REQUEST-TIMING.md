# Request timing (requestTiming)

Small helper collection for measuring per-request timing and toggling it at runtime.

## Overview

- Provides a middleware that records timing for each request and logs or exposes it to a provided logger.
- Exposes a `timing` toggle (enable/disable at runtime).
- Provides an admin router to toggle timing via HTTP and a signal toggle for environments that support process signals.

## Installation / Import

This code lives in the repository's `shared` folder. Import it in one of two ways depending on your setup:

- If you're using a package workspace or have linked the shared package, import from the package name shown in `shared/package.json` (example):

```js
import {
  createRequestTimingMiddleware,
  createTimingToggleRouter,
  registerTimingSignalToggle,
  timing
} from "excel-export-streaming-shared";
```

- Or import directly from the local source path inside this repo (adjust the relative path to where your code lives):

```js
import {
  createRequestTimingMiddleware,
  createTimingToggleRouter,
  registerTimingSignalToggle,
  timing
} from "../../shared/src"; // adjust path as needed
```

## Quick usage

```js
import express from "express";
import {
  createRequestTimingMiddleware,
  createTimingToggleRouter,
  registerTimingSignalToggle,
  timing
} from "@irrational/timing";

const app = express();

app.use(
  createRequestTimingMiddleware({
    logger: console,
    getMeta: (req) => ({ request_id: req.get("x-request-id") })
  })
);

if (process.env.TIMING_ENABLED === "true") timing.enable();

app.use(
  "/_admin",
  createTimingToggleRouter({ requireToken: true, tokenEnv: "ADMIN_TOKEN" })
);

app.listen(3000);
```

## API

- `createRequestTimingMiddleware(options)`
  - `options.logger` — logger object (must support `.info`/`.warn`/`.error` or `console`).
  - `options.getMeta` — optional function `(req) => ({ ... })` to attach request metadata to logs.

- `createTimingToggleRouter(options)`
  - `options.requireToken` — boolean; when true the router will require a token header for toggling.
  - `options.tokenEnv` — environment variable name containing the token.

- `registerTimingSignalToggle(options)` — deprecated/no-op
  - Signal-based toggling has been removed from this repo. Use `createTimingToggleRouter` for runtime toggling via HTTP.

- `timing` — toggle object exposing `.enable()`, `.disable()`, and `.isEnabled()` to check or change state at runtime.

## Notes

- Keep the middleware registered at all times; it checks the `timing` toggle and is cheap when disabled.
- Prefer the admin router for platforms without signals (Windows). For containers/Linux, signal toggles are convenient.
- When using `requireToken`, set the token in the environment before starting the server.

## Tests

See the existing test harness in `/shared/tests` for examples of how to stub the timing toggle and assert behaviour.

---
Generated README for the request-timing system.

## Small helper script

You can toggle the admin API from the command line using the included helper script `shared/bin/toggle-timing.js`.

Usage examples (from repo root):

```bash
# check state
node shared/bin/toggle-timing.js get

# toggle
node shared/bin/toggle-timing.js toggle

# turn on
node shared/bin/toggle-timing.js on

# turn off
node shared/bin/toggle-timing.js off
```

The script will:

- Use `JWT_SECRET` to generate a short-lived token via the repo `shared` JWT helper if present.
- Otherwise use `ADMIN_TOKEN` environment variable directly.
- Read `ADMIN_URL` and `ADMIN_PATH` environment variables to override the target location.

Example (generate a token and toggle):

```bash
JWT_SECRET=... node shared/bin/toggle-timing.js toggle
```

