---
title: Getting started
description: >-
  Prerequisites, Docker Compose setup, and the first-run wizard for running Fetcharr.
---

# Getting started

Fetcharr runs as a single Docker container on a host that shares a LAN with your Fetch TV box.

## Prerequisites

- A **Fetch TV Mighty** PVR on the same LAN as the host running Fetcharr. SSDP/UPnP discovery uses multicast, so the host must be on the same broadcast domain as the box.
- **Docker and Docker Compose** on that host.
- **Plex Media Server** is optional; Fetcharr runs without it, you just won't get the post-sync library refresh. See [Plex](/guide/plex).
- A **Fetch cloud account** (activation code + PIN) is optional; it's required only if you want Fetcharr to delete recordings from the box after they sync. See [Delete from Fetch](/guide/delete-from-fetch).

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
> The example compose uses `network_mode: host` because SSDP multicast (`239.255.255.250:1900`) does not traverse Docker's bridge network. Without host networking, Auto-discover can't find the Fetch box.

## 4. Run the wizard

Browse to `http://<host-ip>:8124`. The first visit opens a setup wizard that walks you through the Fetch box (with Auto-discover), storage (with a TEST PATH button), Plex, and the optional Fetch Cloud step. Everything is editable later in Settings, and the wizard can be re-opened from there at any time.

Then mark shows to follow on the Shows tab; see [Following shows](/guide/following-shows).

## Updating

```sh
git pull
docker compose up -d --build fetcharr
```

This rebuilds the image and recreates the container only if the image actually changed; your state database is untouched, and any pending migrations run automatically on next boot.

## Where next

- [Following shows](/guide/following-shows) — the core loop: pick shows, point them at folders, sync.
- [Configuration](/guide/configuration) — the full `.env` reference.
- [Troubleshooting](/guide/troubleshooting) — if Auto-discover, Plex, or a download misbehaves.
