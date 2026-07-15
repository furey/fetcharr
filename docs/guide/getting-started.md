---
title: Getting started
description: >-
  Prerequisites, Docker Compose setup, the first-run wizard, configuration, and
  troubleshooting for running Fetcharr.
---

# Getting started

Fetcharr runs as a single Docker container on a host that shares a LAN with your Fetch TV box.

## Prerequisites

- A **Fetch TV Mighty** PVR on the same LAN as the host running Fetcharr. SSDP/UPnP discovery uses multicast, so the host must be on the same broadcast domain as the box.
- **Docker and Docker Compose** on that host.
- **Plex Media Server** is optional; Fetcharr runs without it, you just won't get the post-sync library refresh.
- A **Fetch cloud account** (activation code + PIN) is optional; it's required only if you want Fetcharr to delete recordings from the box after they sync.

## Quick start

### 1. Get the code

```sh
git clone https://github.com/furey/fetcharr
cd fetcharr
```

### 2. Configure

Copy `docker-compose.example.yml` to `docker-compose.yml`, then create a `.env` alongside it with your host paths:

```ini
CONFIG_PATH=/path/to/your/config
DATA_PATH=/path/to/your/media
CSRF_SECRET=paste-openssl-rand-hex-32
TZ=Australia/Sydney
PUID=1000
PGID=1000
FETCHARR_PORT=8124

# Optional: only if Plex runs on this host and you want the Auto-detect token
# button. Leave it out entirely if not; the mount defaults to a no-op.
# PLEX_PREFS_PATH=/path/to/Plex/Preferences.xml
```

`CONFIG_PATH`, `DATA_PATH`, and `CSRF_SECRET` are required; compose stops with a clear message if any is missing rather than starting with broken mounts.

### 3. Start it

```sh
docker compose up -d
docker compose logs -f
```

> [!IMPORTANT]<br>
> The example compose uses `network_mode: host` because SSDP multicast (`239.255.255.250:1900`) does not traverse Docker's bridge network. Without host networking, Auto-discover can't find the Fetch box.

### 4. Run the wizard

Browse to `http://<host-ip>:8124`. The first visit opens a setup wizard that walks you through the Fetch box (with Auto-discover), storage (with a TEST PATH button), Plex, and the optional Fetch Cloud step. Everything is editable later in Settings, and the wizard can be re-opened from there at any time.

Mark shows to follow on the Shows tab and Fetcharr syncs them on the schedule you set.

### Updating

```sh
git pull
docker compose up -d --build fetcharr
```

This rebuilds the image and recreates the container only if the image actually changed; your state database is untouched, and any pending migrations run automatically on next boot.

## Configuration

The Fetch TV box address and all integration credentials (Plex token, Fetch cloud activation code, and so on) are runtime settings; configure them in the web UI, not via env. The `.env` next to your compose file only carries deploy-level knobs:

| Variable          | Purpose                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`     | Host folder for Fetcharr's state database                                                                         |
| `DATA_PATH`       | Host folder containing your Plex TV library (downloads land under `media/tv`)                                     |
| `PLEX_PREFS_PATH` | Optional. Path to Plex's `Preferences.xml`, used by the Auto-detect token button; omit if Plex is on another host |
| `CSRF_SECRET`     | 32+ random bytes (`openssl rand -hex 32`); required                                                                |
| `TZ`              | Your IANA timezone (e.g. `Australia/Sydney`); the UI renders all timestamps in it                                 |
| `PUID`/`PGID`     | UID/GID to run as; match the owner of your bind-mounted folders                                                    |
| `FETCHARR_PORT`   | Host port to serve on (default `8124`)                                                                             |

The full environment reference, including the settings fallback chain, is in the [deep dive](/deep-dive#full-environment-reference).

### Ad removal

Ad removal is configured at runtime, not via env: enable it in Settings → AD REMOVAL (off by default), then pick a per-show mode on the Shows tab. `DETECT` records where the ad breaks are without touching the file; `CUT` removes them and keeps the original as `<file>.ts.orig` for a configurable number of days (default 7). Fetcharr ships a `comskip.ini` tuned for Australian free-to-air; drop your own `comskip.ini` into the `/config` bind mount to override it.

Detection accuracy on free-to-air varies by channel, so trial `DETECT` mode before trusting cuts. The full pipeline is in the [deep dive](/deep-dive#ad-removal).

![The Settings tab](../img/screenshot-settings.png)

## Security

Fetcharr has no login; anyone who can reach the port can view state and change settings. CSRF protection, rate limiting, a strict CSP, and `noindex` headers are all in place, but the design assumes a trusted home LAN: don't port-forward or reverse-proxy it to the internet. The full [security model](/deep-dive#security-model) covers the HTTP headers and supply-chain hardening; vulnerability reporting and accepted residual risks are in [SECURITY.md](https://github.com/furey/fetcharr/blob/main/SECURITY.md).

## Troubleshooting

**Auto-discover can't find the Fetch box**

- The container must run with host networking (the example compose already does); SSDP multicast doesn't cross Docker's bridge network.
- The host must be on the same LAN/broadcast domain as the box; multicast doesn't cross subnets without help.
- You can always enter the box's IP and port manually in Settings instead.

**Plex token auto-detect fails**

- It needs Plex's `Preferences.xml` bind-mounted into the container (`PLEX_PREFS_PATH`), which only works when Plex runs on the same host.
- Paste the token manually instead; grab it from `app.plex.tv` (or Plex's own support article on finding your token).

**An episode was skipped with "currently recording"**

- That's deliberate: Fetch reports misleading sizes while a recording is live, so Fetcharr refuses to download it rather than save a truncated file. It syncs on the next run after the recording finishes.

**A recording shows `partial`**

- The downloaded bytes fell short of what Fetch reported. The next sync resumes from where it stopped (HTTP Range), so partials normally heal themselves.

**Delete-from-Fetch fails with "No I_AM_ALIVE reply" (or "Timed out waiting for I_AM_ALIVE handshake")**

- The reply comes from your Fetch box via Fetch's cloud, and a box whose cloud session has dozed off misses the ping even though it works fine on the LAN. Fetcharr pings twice (20 s) before giving up, and the first attempt usually wakes the box's session, so just retry the delete after a moment.
- If it keeps failing, open the official Fetch mobile app: if the app can't see the box either, the box↔cloud link is down; restarting the box resets it. The [deep dive](/deep-dive#why-delete-from-fetch-goes-through-the-cloud-not-lan) has the mechanics.

**Other containers can't reach Fetcharr by name**

- A side-effect of host networking: Fetcharr isn't on any Docker bridge network. Reach it via the host's LAN IP and `FETCHARR_PORT` instead.

**Ad detection is cutting the wrong things (or missing breaks)**

- Commercial detection is heuristic and never perfect. Comskip's accuracy on AU free-to-air varies noticeably by channel (logo detection, silence thresholds, break lengths all differ).
- Run the show in `DETECT` mode first and check the reported break counts/minutes on the Recordings tab before switching to `CUT`. Scans are CPU-bound: budget ~30 minutes per 75-minute recording on NAS-class hardware.
- Cuts snap to keyframes, so a second or two of slop either side of a break is expected.
- To tune detection, place your own `comskip.ini` in the `/config` bind mount; it overrides the bundled AU-tuned default. Every cut keeps a `<file>.ts.orig` backup for the retention window, so a bad cut is recoverable by renaming the `.orig` back.

**Timestamps show the wrong time**

- Set `TZ` in your `.env` to your IANA zone; the UI renders every timestamp in the container's zone, whatever device you're browsing from.

**Permission errors writing to `/config` or `/media/tv`**

- Set `PUID`/`PGID` to match the owner of the bind-mounted host folders.
