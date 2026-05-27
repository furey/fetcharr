<p align="center">
  <img src="docs/img/logo.svg" alt="fetcharr" width="240"/>
</p>

<p align="center">
  <strong>Sync Fetch TV PVR recordings into Plex.</strong><br/>
  A self-hosted bridge for Australian Fetch TV DVB-T set-top boxes.
</p>

<p align="center">
  <img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-f10c69.svg?style=flat-square"/>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-009be4.svg?style=flat-square"/>
  <img alt="Docker" src="https://img.shields.io/badge/docker-compose-009be4.svg?style=flat-square"/>
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/furey/fetcharr.svg?style=flat-square&color=e2b03c"/>
  <img alt="No auth" src="https://img.shields.io/badge/auth-LAN%20only-8b837e.svg?style=flat-square"/>
</p>

## Contents

- [What Fetcharr is](#what-fetcharr-is)
- [What Fetcharr isn't](#what-fetcharr-isnt)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Layout](#project-layout)
- [Scripts](#scripts)
- [Environment](#environment)
- [Docker Deployment](#docker-deployment)
- [Sync State Machine](#sync-state-machine)
- [`fetchtv` Dependency](#fetchtv-dependency)
- [Security](#security)
- [Testing](#testing)
- [Disclaimer](#disclaimer)
- [Support](#support)

## What Fetcharr is

**Fetcharr** watches a Fetch TV box on your LAN, downloads new episodes of shows you mark to follow, drops the files into your Plex TV library, pokes Plex to scan, and optionally deletes the recording from the Fetch box once Plex confirms the file.

It's the missing automation layer if your media stack is **Fetch TV → Plex**.

<p align="center">
  <img src="docs/img/screenshot-dashboard.png" alt="Dashboard tab: sync deck, tally cards, recent syncs, integration status" width="100%"/>
  <br/><em>Dashboard: live SYNC/IDLE deck, tally cards, and latest sync outcomes.</em>
</p>

<p align="center">
  <img src="docs/img/screenshot-shows.png" alt="Shows tab: per-show tracking table and add-show form" width="100%"/>
  <br/><em>Shows: per-show tracking, destination folder + season template, per-show sync.</em>
</p>

<p align="center">
  <img src="docs/img/screenshot-recordings.png" alt="Recordings tab: filters, sortable columns, tombstoned rows" width="100%"/>
  <br/><em>Recordings: filters, sortable headers, easily identifiable rows already deleted from the Fetch box, etc.</em>
</p>

<p align="center">
  <img src="docs/img/screenshot-syncs.png" alt="Syncs tab: activity filter chips, sync history table" width="100%"/>
  <br/><em>Syncs: activity-type filters over a capped sync history.</em>
</p>

## What Fetcharr isn't

- ❌ **Indexer integration:** (e.g. Sonarr / Radarr / Prowlarr) Fetcharr only consumes what Fetch has already recorded; it doesn't tell Fetch *what* to record. Use your Fetch TV box's own EPG to schedule recordings.
- ❌ **Authentication:** designed for trusted LAN deployments. CSRF, rate-limiting, and a strict CSP are in place, but there's no login. Don't expose it to the internet.
- ❌ **Remux / transcode:** files land as `.ts` from the box. Add Tdarr or similar downstream if you need `.mkv`.
- ❌ **Notifications:** no Discord / ntfy / push integration.

> [!IMPORTANT]<br>
> Tested against **Fetch TV Mighty 3** + **Plex Media Server**. Other Fetch hardware/firmware is unverified.

## Features

- **Zero-config discovery**: finds your Fetch TV box (SSDP) and Plex server (GDM) on the LAN, and auto-detects the Plex token from a bind-mounted `Preferences.xml`.
- **First-run wizard**: walks Fetch box → storage → Plex → optional Fetch Cloud. Re-openable from Settings; previously-saved values prefill.
- **Per-show follow**: pick a Fetch show, fuzzy-match it to an existing folder under `media_root`, set a season template. Done.
- **Scheduled + manual sync**: cron-configurable polling, plus on-demand global or per-show **Sync now**.
- **In-progress recording protection**: refuses to download a half-recorded show. Fetch reports misleading sizes during live record; Fetcharr catches the sentinels (and HEAD-probes stale DLNA metadata) so you never end up with truncated files.
- **Resumable + truncation-aware downloads**: HTTP Range resume across syncs; if on-disk bytes fall short of what Fetch reported, the row stays `partial` and the next sync picks up the remainder.
- **Plex integration**: section-refresh after every sync that downloaded something, plus a **Refresh Plex now** button.
- **Optional delete-from-Fetch**: once Plex confirms the file, free up the box. Has to go through Fetch's cloud API (see: [rationale below](#why-delete-from-fetch-goes-through-the-cloud-not-lan)).
- **Self-housekeeping**: sync history auto-prunes to the latest 500 rows; recording rows age out 30 days after delete-from-Fetch. No manual cleanup.
- **TZ-aware UI**: container `TZ` propagates to the browser; timestamps render in that zone regardless of which device hits the page.
- **Danger Zone**: one-click `NUKE ALL STATE` reset back to the welcome wizard. DB only; downloaded media files untouched.
- **Authless LAN service**: SQLite-backed, single Docker container, no external runtime dependencies once configured.

### Why delete-from-Fetch goes through the cloud, not LAN

The original plan was UPnP `DestroyObject` from upstream [`fetchtv`](https://github.com/furey/fetchtv), which turned out to be impossible:

- Fetch firmware advertises `DestroyObject` in its ContentDirectory SCPD but the request handler rejects it with `Unknown Service Action`.
- HTTP `DELETE` on item URLs returns 501.
- No vendor-specific local services are advertised.

The only working deletion path is Fetch's cloud APIs (HTTPS auth + WebSocket to `messages.fetchtv.com.au` with the user's activation code + PIN; see [`pyfetchtv`](https://github.com/jinxo13/pyfetchtv) for the reference implementation).

## Prerequisites

- A **Fetch TV Mighty** PVR on the same LAN as the host running Fetcharr (SSDP/UPnP discovery uses multicast, so Fetcharr's host must be on the same broadcast domain as the box).
- **Node 22+** for local dev, or **Docker** for the container path.
- **Plex Media Server** is *optional*; Fetcharr will run without it; you just won't get the post-sync library refresh.
- **Fetch cloud account** (activation code + PIN) is *optional*; required only if you want Fetcharr to delete recordings from the box after they sync, since the LAN-side delete API on Fetch is broken (see: [Features](#features)).

## Quick Start

- [Local (Node)](#local-node)
- [Docker](#docker)

### Local (Node)

```sh
git clone <repo> fetcharr
cd fetcharr
cp .env.example .env       # fill in CSRF_SECRET (openssl rand -hex 32)
npm run setup              # ci --ignore-scripts + rebuild natives + audit signatures
npm start                  # http://localhost:8124; first visit shows the setup wizard
                           # (prestart auto-creates ./config/ and runs migrations)
```

> [!NOTE]<br>
> `npm run setup` calls `npm audit signatures`, which honours `.npmrc`'s `min-release-age=3`. If a dep in the lockfile was published in the last 3 days, the audit step will fail (`ETARGET notarget`). Either wait for it to age past the threshold or run `npm install --ignore-scripts --min-release-age=0` once for the freshly-published dep.

> [!TIP]<br>
> `package.json`'s `volta` block pins `node@22.19.0` + `npm@11.15.0` (matching the Dockerfile's `node:22-alpine` + `npm@11.15.0`). Install [Volta](https://volta.sh) and it'll auto-switch when you `cd` into the repo (avoids `EBADENGINE` from the host npm and ABI mismatches on `better-sqlite3`).

For dev:

```sh
npm run dev                # node --watch
npm run migrate:refresh    # drop the SQLite DB and re-migrate
```

### Docker

Copy `docker-compose.example.yml` to `docker-compose.yml` and fill in the host paths in a sibling `.env`:

```env
CONFIG_PATH=/path/to/your/config
DATA_PATH=/path/to/your/media
PLEX_PREFS_PATH=/path/to/Plex/Preferences.xml   # optional
CSRF_SECRET=<openssl rand -hex 32>
TZ=Australia/Sydney
PUID=1000
PGID=1000
FETCHARR_PORT=8124
```

Then:

```sh
docker compose up -d
docker compose logs -f
```

After pulling code changes, rebuild the image and recreate the container in one step:

```sh
git pull
docker compose up -d --build fetcharr
```

`up -d --build` rebuilds the image from the local `Dockerfile` and recreates the container only if its image actually changed; the bind-mounted `/config/state.db` is untouched. Any pending migrations run on next boot via `docker-entrypoint.sh`.

The container entrypoint (`docker-entrypoint.sh`) runs `knex migrate:latest` against `/config/state.db` (the bind-mounted SQLite file) before exec'ing the server, so first boot on a fresh host is a no-op for the operator. See: [Docker Deployment](#docker-deployment).

> [!IMPORTANT]<br>
> The example compose uses `network_mode: host` because SSDP multicast (`239.255.255.250:1900`) does not traverse Docker's bridge network. Without host networking **Auto-discover** can't find the Fetch box.

## Project Layout

```
fetcharr/
├── src/
│   ├── server.js           # Express app; helmet, CSP, rate limit, CSRF, X-Robots-Tag
│   ├── db.js               # Knex instance + simple settings get/set
│   ├── folder-matcher.js   # Fuse.js wrapper that scans /media/tv
│   ├── sync.js             # Sync engine; discover, browse, match shows, download, persist; exports classifyOutcome / matchShow / buildDestPath for tests
│   ├── scheduler.js        # node-cron wiring, reloads on settings change
│   ├── plex.js             # Plex section refresh + token detection from Preferences.xml
│   ├── fetch-cloud.js      # Fetch cloud WebSocket client for delete-from-box
│   └── web/                # Static UI; Vue 3 SPA (browser ESM) + Tailwind v4 Play CDN (self-hosted), hash-routed across 5 tabs, no build step
├── test/
│   ├── sync.test.js        # node --test: matchShow, buildDestPath, classifyOutcome state-transition truth table
│   └── folder-matcher.test.js # node --test: real on-disk fixture under os.tmpdir()
├── migrations/
│   └── 0001_initial.js     # Initial schema; additive migrations from here on
├── knexfile.js             # Honours DB_PATH env (defaults to ./config/state.db)
├── Dockerfile              # node:22-alpine + tini + healthcheck
├── docker-entrypoint.sh    # `knex migrate:latest` then `exec node src/server.js`
├── docker-compose.example.yml  # Generic compose template; copy to docker-compose.yml
├── .env.example            # Local-dev minimal envs (CSRF_SECRET, TZ, PUID/PGID)
├── .npmrc                  # Supply-chain hardening
└── package.json            # fetchtv installed from npm (pinned exactly)
```

## Scripts

| Script                    | What it does                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run setup`           | `npm ci --ignore-scripts` → `npm run rebuild:natives` → `npm audit signatures`             |
| `npm run rebuild:natives` | Explicitly rebuilds the native deps allow-listed in `package.json` (just `better-sqlite3`) |
| `npm run migrate`         | `mkdir -p config && knex migrate:latest`; idempotent, auto-run by `start` / `dev`          |
| `npm run migrate:refresh` | `rm -f ./config/state.db && mkdir -p config && knex migrate:latest`; dev only              |
| `npm start`               | `node src/server.js` (chains `npm run migrate` via `prestart`)                             |
| `npm run dev`             | `node --watch src/server.js` (chains `npm run migrate` via `predev`)                       |
| `npm test`                | `node --test 'test/*.test.js'`; Node 22 built-in runner, no extra deps                     |

## Environment

The Fetch TV box IP/port and all integration credentials (Plex token, Fetch cloud activation code, etc.) are runtime settings; configure them in the web UI (or the first-run wizard), not via env. The env vars below are deploy/runtime knobs only.

> [!NOTE]<br>
> `MEDIA_ROOT` and `PLEX_PREFS_PATH` also act as **defaults** for matching DB-backed settings that can be overridden from the UI at runtime. The fallback chain is *settings DB value → env var → hardcoded default*. The Storage panel in Settings (and the STORAGE step of the wizard) shows the effective value and provides a TEST PATH button.

| Variable      | Notes                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_ROOT`  | **Default** for the `media_root` runtime setting (directory where Fetcharr writes downloads). Defaults to `/media/tv`. Override at runtime from the Settings UI's Storage panel.                                                                                    |
| `DB_PATH`     | Absolute path to the SQLite state file. Defaults to `<repo>/config/state.db`; compose sets it to `/config/state.db` so state lives on the bind mount.                                                                                                               |
| `PORT`        | HTTP port inside the container. Defaults to `8124`.                                                                                                                                                                                                                 |
| `NODE_ENV`    | `production` makes the server refuse to start if `CSRF_SECRET` is unset or the dev placeholder. Compose sets this.                                                                                                                                                  |
| `TZ`          | Container timezone (IANA name, e.g. `Australia/Sydney`). The Dockerfile installs `tzdata` so any IANA zone resolves. `/api/settings` exposes the value as `tz`; the web UI uses it to render all timestamps in that zone regardless of which browser hits the page. |
| `PUID`/`PGID` | Runtime UID/GID (set via compose `user:`). Defaults to `1000:1000`. Set to match the owner of the bind-mounted host paths.                                                                                                                                          |
| `CSRF_SECRET` | 32+ random bytes used to sign the CSRF cookie. `openssl rand -hex 32`. Required in production.                                                                                                                                                                      |

Compose-only env (set in `.env` alongside `docker-compose.yml`):

| Variable          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FETCHARR_PORT`   | Host port the container binds (under `network_mode: host`, also flows into `PORT` inside the container). Defaults to `8124`.                                                                                                                                                                                                                                                                                                                                                                                         |
| `CONFIG_PATH`     | Host root for the SQLite state bind mount. The container's `/config` is `${CONFIG_PATH}/fetcharr`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `DATA_PATH`       | Host root for media bind mounts. The container's `/media/tv` is `${DATA_PATH}/media/tv`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PLEX_PREFS_PATH` | Optional. Host path to Plex's `Preferences.xml`, bind-mounted read-only into the container so the "Auto-detect from local Plex" button can fish out `PlexOnlineToken`. Drop the bind-mount entirely from your compose if Plex isn't on this host; the auto-detect button degrades gracefully, and you can paste the token manually from `app.plex.tv`. Inside the container, the path defaults to `/plex-preferences.xml` and is **overridable** as the `plex_prefs_path` runtime setting (Settings panel for Plex). |

## Docker Deployment

- Image is **built locally** from the repo via compose. Nothing is pushed to a registry.
- The Dockerfile inlines `npm ci --ignore-scripts && npm run rebuild:natives` instead of calling `npm run setup`, deliberately skipping `npm audit signatures` at build time. That step re-queries the registry and enforces `.npmrc`'s `min-release-age=3`, which would block whenever a brand-new dep (e.g. a just-published `fetchtv` release) is in the lockfile. Run `npm run setup` (or `npm audit signatures`) on the host once the newest dep has aged past the threshold; the lockfile's integrity hashes still verify package contents during `npm ci`.
- Uses `network_mode: host` (no `ports:` mapping); required for SSDP/UPnP auto-discovery of the Fetch TV box, since multicast `239.255.255.250:1900` doesn't traverse Docker's bridge network. Side-effect: Fetcharr is **not** on any Docker bridge network; other containers reach it via the host's LAN IP on `${FETCHARR_PORT}` rather than by container name.
- Runs as `${PUID}:${PGID}` (default `1000:1000`) so bind-mounted files have the right owner.
- `tini` is PID 1 inside the container so `SIGTERM` propagates cleanly.
- The Docker healthcheck hits `GET /healthz` every 30s.

Volumes:

| Container path               | Host path                 | Purpose                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/config`                    | `${CONFIG_PATH}/fetcharr` | SQLite state DB; persisted across container recreate.                                                                                                                                                                          |
| `/media/tv`                  | `${DATA_PATH}/media/tv`   | Plex TV library (where downloads save to). Container-side path is the `MEDIA_ROOT` env default; can be overridden at runtime as the `media_root` setting (only useful if you mount the library at a different container path). |
| `/plex-preferences.xml` (ro) | `${PLEX_PREFS_PATH}`      | Optional. Local Plex `Preferences.xml` (read-only, only used by the "Auto-detect from local Plex" button to find `PlexOnlineToken`). Drop this volume entry if Plex isn't on the same host.                                    |

## Sync State Machine

The sync engine (`src/sync.js`) processes each item Fetch returns through this decision tree:

1. **Already-done short-circuit**: if a `recordings` row exists with `status='done'`, skip immediately.
2. **In-progress guard**: `await isCurrentlyRecording(item)` (from `fetchtv`) returns `true` when the UPnP listing reports size <= 0 (Fetch's `-1` "size unknown" sentinel) **or** the MAX_OCTET marker (`4398046510080`), **or** when a HEAD probe reveals a content-length matching the marker. On any of those, write the row as `skipped` with `error='currently recording'` and bail.
3. **Download**: build the destination path from the show's `dest_folder` + `season_template`, mkdir, then call `downloadFile`. The downloader supports HTTP Range resume; a partial-from-last-time row will pick up where it left off rather than re-downloading.
4. **Classify the outcome** via `classifyOutcome({ downloadResult, expectedSize, actualSize, tolerance })`; a pure function (exported for tests) that returns `{ dbStatus, summaryKey, sizeToStore, markDownloadedAt, error }`:
   - `result.recorded && shortfall ≤ tolerance` → `done` / `downloaded`, store actual size.
   - `result.recorded && shortfall > tolerance` (default 1 MB) → `partial` / `failed`, store actual size, error explains the byte gap. Next sync's resume will fix it.
   - `result.recorded && actualSize unknown` (post-download `fs.stat` failed) → `done`, trust expected.
   - `result.recorded && expectedSize <= 0` → `done` (guard; shouldn't reach this branch in practice).
   - `!result.recorded && result.error` → `failed` / `failed`, sizeToStore stays null (leaves existing row's size alone).
   - `!result.recorded && result.warning` (e.g. "currently recording" warning from downloadFile) → `partial` / `skipped`.

Every branch of `classifyOutcome` is covered by `test/sync.test.js`. The wider sync flow (DB writes, `downloadFile` invocation, mkdir, Plex notify) lives outside `classifyOutcome` and is currently exercised end-to-end against the real Fetch box rather than via integration tests.

If a sync ran without any `result.error` but did get one or more truncations, the sync is marked `partial` overall; only summary `failed > 0` triggers a non-`ok` sync status. Truncations land in `summary.failed` (not `summary.skipped`) so they're visible at a glance.

## `fetchtv` Dependency

[`fetchtv`](https://github.com/furey/fetchtv) is installed as a regular npm dep, **pinned exactly** (no caret) per `.npmrc`'s `save-exact=true`. The pinned version is in `package.json`.

To bump fetchtv:

```sh
npm install --save-exact fetchtv@<new-version>
```

The `min-release-age=3` hardening rule in `.npmrc` will refuse versions newer than 3 days. If you need a hot bump (e.g. you just published a fix yourself), pass `--min-release-age=0` for that single command. The Docker build path is unaffected (it uses `npm ci` from the lockfile, which doesn't re-check the rule); only `npm audit signatures` (called by `npm run setup`) re-checks and will block until the package ages past the threshold; see: [Docker Deployment](#docker-deployment). Limit `--min-release-age=0` to packages you personally just published: the resulting `package-lock.json` change carries the fresh dep into every subsequent `npm ci` (Docker image rebuilds included), since lockfile integrity hashes verify content but not recency.

## Security

- **`.npmrc`** sets:
  - `ignore-scripts=true`: never run lifecycle scripts during install. Native rebuilds are explicit via `rebuild:natives`.
  - `engine-strict=true`: fail install if `engines` mismatch.
  - `audit-level=high`: `npm audit` exits non-zero only on `high`+.
  - `save-exact=true`: new deps are pinned exactly.
  - `package-lock=true`: always write `package-lock.json`.
  - `min-release-age=3`: refuse packages newer than 3 days (mitigates rapid-fire supply-chain attacks).
- **`npm run setup`** uses `npm ci` (not `npm install`) so deps come straight from the lock file.
- **`npm run rebuild:natives`** is an explicit allow-list; only `better-sqlite3` rebuilds. Adding a new native dep means adding it here on purpose.
- **`npm audit signatures`** runs as the last step of `setup` to verify the npm registry signatures of every dep. The Docker build deliberately inlines `npm ci + rebuild:natives` instead of calling `npm run setup` because `npm audit signatures` re-queries the registry and enforces `min-release-age`, which would block builds whenever a freshly-published dep is in the lockfile. Run `npm run setup` (or `npm audit signatures` directly) on the host once the newest dep ages past the threshold; see: [Docker Deployment](#docker-deployment).
- **`package-lock.json`** is committed; integrity hashes verify package contents during `npm ci` even when the audit step is skipped.
- **HTTP**: Helmet with a strict CSP. `script-src 'self' 'unsafe-eval'` is required because Vue's in-browser template compiler uses `new Function()`; everything else is locked down. To drop `'unsafe-eval'` we would need a build step (Vite) that pre-compiles templates.
- **Rate limiting**: `express-rate-limit` on the on-demand POST endpoints that hit the Fetch box, Fetch cloud, or Plex (`/api/sync`, `/api/fetch-shows`, `/api/discover-fetch`, `/api/discover-plex`, `/api/fetch-cloud-test`).
- **CSRF**: `csrf-csrf` (double-submit cookie) protects state-changing POSTs. The UI fetches a token from `GET /api/csrf-token` and sends it as the `x-csrf-token` header. `generateToken` is called with `overwrite=true` so a stale browser cookie from a previous `CSRF_SECRET` doesn't trigger a 403 mint. `getSessionIdentifier` is a constant; authless LAN service, and `req.ip` flapped under Docker bridge networking. The front-end clears the cached token and retries once on any 403, so secret rotations / cookie clears recover silently.
- **Indexing**: `X-Robots-Tag: noindex, nofollow` is set globally; this is a LAN-only service.
- **HSTS disabled**: Fetcharr serves over plain HTTP on the LAN. Helmet's default `Strict-Transport-Security` header would tell browsers to refuse HTTP for the host for a year, which is wrong for this deployment. Re-enable HSTS (with an appropriate `maxAge`) only when fronted by TLS.

## Testing

Run the automated suite with:

```sh
npm test
```

Uses Node 22's built-in test runner (`node --test`) (no additional test dependencies). Two files under `test/`:

- **`test/sync.test.js`**: exhaustive truth-table coverage of `classifyOutcome` (every state-machine transition incl. the real-world MPEG-TS Δ-20-byte case + `-1` sentinel handling), plus pure-function tests for `matchShow` (case-insensitive substring matching) and `buildDestPath` (`{season}` / `{season_padded}` / `{season_unpadded}` substitution, filesystem-safe filename sanitisation, missing-season fallback).
- **`test/folder-matcher.test.js`**: real on-disk fixture under `os.tmpdir()` exercising `listShowFolders` + `matchShowFolder` against realistic disambiguated folder names (`Bluey (2018)`, `LOL - Last One Laughing UK`, etc.).

The wider sync flow (DB transitions, `downloadFile` invocation, Plex notify) is still exercised end-to-end against the live Fetch box rather than via integration tests with mocks. Manual smoke test:

- `npm run dev` (or `MEDIA_ROOT=/path/to/media/tv npm run dev` outside the container), hit `http://localhost:8124`.
- **First visit** (with empty settings): auto-redirects to `#/welcome` for the setup wizard. Walks Fetch TV box → storage (media root + TEST PATH) → Plex → Fetch Cloud (with Terminal ID picker after TEST CONNECTION) → ready.
- **Re-open the wizard later**: SETUP WIZARD panel at the top of Settings → `↻ REOPEN WIZARD`. All previously-saved values prefill (stored Plex token / Fetch PIN render as `••••• (stored)`); step 1 surfaces a *RETURN VISIT* badge so you know you're editing existing config.
- **Settings**: save / discover; cron field reloads the scheduler on save; Plex Auto-discover / Auto-detect token / Load sections / Refresh now buttons should each succeed when Plex is reachable; Storage panel TEST PATH probes `media_root` for existence + writability.
- **Shows**: on first visit (no shows yet, Fetch IP configured) auto-runs Refresh Shows to populate the datalist. Add a show (folder-suggest auto-completes from the effective `media_root`, falls back to a "new folder" suggestion when no match), toggle enabled, per-show Sync now, delete.
- **Syncs**: Run sync now (global + per-show), watch the row appear and finish; clear individual or all history; chip-filter by activity type (DOWNLOADS / FAILS / DELETES / EMPTY).
- **Recordings**: rows update live during a sync and re-poll every 60 s otherwise; sizes render in the configured `TZ` in 12-hour AM/PM. Tombstoned rows (deleted from the Fetch box) appear struck-through + dimmed; filter via `ON FETCH` / `DELETED` chips; `WHEN` includes `1H` / `24H` for recent activity.
- **Danger Zone**: `NUKE ALL STATE` button clears the DB and reloads into the wizard.

### Regenerating the README screenshots

The PNGs under `docs/img/` are captured from the running app by `scripts/capture-screenshots.sh`. The script pulls the official Playwright Docker image (no host install required), drives headless Chromium across all four tabs, and writes the screenshots back into `docs/img/` with the right ownership.

```sh
# fetcharr container must be up + reachable at $FETCHARR_URL (default http://localhost:8124)
./scripts/capture-screenshots.sh

# Or point at a remote instance / pin a different Playwright image:
FETCHARR_URL=http://nas.lan:8124 \
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.50.0-noble \
  ./scripts/capture-screenshots.sh
```

The captures themselves are configured in `scripts/capture-screenshots.mjs` (viewport 1280×936, viewport-only clip so every shot has the same aspect ratio, 2× device-scale).

## Disclaimer

This project:

- Is licensed under the [GNU GPLv3 License](./LICENSE).
- Is not affiliated with or endorsed by Fetch TV or Plex.
- Is built on top of the [`fetchtv`](https://github.com/furey/fetchtv) npm package for LAN-side Fetch TV access.
- Is written with the assistance of AI and may contain errors.
- Is intended for educational and experimental purposes only.
- Is provided as-is with no warranty—please use at your own risk.

## Support

If you've found this project helpful consider supporting my work through:

[Buy Me a Coffee](https://www.buymeacoffee.com/furey) | [GitHub Sponsorship](https://github.com/sponsors/furey)

Contributions help me continue developing and improving this tool, allowing me to dedicate more time to add new features and ensuring it remains a valuable resource for the community.
