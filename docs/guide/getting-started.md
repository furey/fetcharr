---
title: Getting started
description: >-
  Prerequisites, Docker Compose setup, and the first-run wizard for running Fetcharr.
---

# Getting started

Fetcharr runs as a single Docker container on the same LAN as your Fetch TV box.

## Prerequisites

- A **Fetch TV Mighty** (the box that records your TV, a PVR) on the same network as the machine running Fetcharr. Fetcharr finds the box by listening for the announcement it broadcasts on the network (a protocol called SSDP), and those broadcasts don't travel between separate parts of a network, so both have to sit on the same one.
- **Docker and Docker Compose** on that host.
- **Plex Media Server** is optional. Fetcharr runs fine without it; you just won't get the automatic Plex library refresh after a sync. See [Plex](/guide/plex).
- A **Fetch cloud account** (activation code + PIN) is optional. You only need it if you want Fetcharr to delete recordings from the box once they've synced. See [Delete from Fetch](/guide/delete-from-fetch).

## 1. Get the code

```sh
git clone https://github.com/furey/fetcharr
cd fetcharr
```

## 2. Configure

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

`CONFIG_PATH`, `DATA_PATH`, and `CSRF_SECRET` are required; compose stops with a clear message if any is missing rather than starting with broken mounts. Every variable is explained in [Configuration](/guide/configuration).

## 3. Start it

```sh
docker compose up -d
docker compose logs -f
```

> [!IMPORTANT]<br>
> The example compose uses `network_mode: host` because the box's announcement (SSDP multicast, `239.255.255.250:1900`) doesn't cross Docker's own private bridge network. Without host networking, Auto-discover can't find the Fetch box.

## 4. Run the wizard

Browse to `http://<host-ip>:8124`. The first visit opens a setup wizard that walks you through the Fetch box (with Auto-discover), storage (with a TEST PATH button), Plex, and the optional Fetch Cloud step. You can change all of it later in Settings, and reopen the wizard from there whenever you like.

Then mark shows to follow on the Shows tab; see [Following shows](/guide/following-shows).

## Updating

```sh
git pull
docker compose up -d --build fetcharr
```

This rebuilds the image and recreates the container only if the image actually changed. Your database is left alone, and any pending database updates (migrations) run automatically on the next start.

## Where next

- [Following shows](/guide/following-shows) — the core loop: pick shows, point them at folders, sync.
- [Configuration](/guide/configuration) — the full `.env` reference.
- [Troubleshooting](/guide/troubleshooting) — if Auto-discover, Plex, or a download misbehaves.
