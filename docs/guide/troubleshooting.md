---
title: Troubleshooting
description: Fixes for the common snags — discovery, Plex, downloads, deletes, ad detection.
---

# Troubleshooting

## Auto-discover can't find the Fetch box

- The container must run with host networking (the example compose already does); SSDP multicast doesn't cross Docker's bridge network.
- The host must be on the same LAN/broadcast domain as the box; multicast doesn't cross subnets without help.
- You can always enter the box's IP and port manually in Settings instead.

## Plex token auto-detect fails

- It needs Plex's `Preferences.xml` bind-mounted into the container (`PLEX_PREFS_PATH`), which only works when Plex runs on the same host.
- Paste the token manually instead; grab it from `app.plex.tv` (or Plex's own support article on finding your token). See [Plex](/guide/plex).

## An episode was skipped with "currently recording"

- That's deliberate: Fetch reports misleading sizes while a recording is live, so Fetcharr refuses to download it rather than save a truncated file. It syncs on the next run after the recording finishes.

## A recording shows `partial`

- The downloaded bytes fell short of what Fetch reported. The next sync resumes from where it stopped (HTTP Range), so partials normally heal themselves.

## Delete-from-Fetch fails {#delete-from-fetch-fails}

Symptoms: "No I_AM_ALIVE reply" or "Timed out waiting for I_AM_ALIVE handshake".

- The reply comes from your Fetch box via Fetch's cloud, and a box whose cloud session has dozed off misses the ping even though it works fine on the LAN. Fetcharr pings twice (20 s) before giving up, and the first attempt usually wakes the box's session, so just retry the delete after a moment.
- If it keeps failing, open the official Fetch mobile app: if the app can't see the box either, the box↔cloud link is down; restarting the box resets it. See [Delete from Fetch](/guide/delete-from-fetch) and the [deep dive](/deep-dive#why-delete-from-fetch-goes-through-the-cloud-not-lan).

## Other containers can't reach Fetcharr by name

- A side-effect of host networking: Fetcharr isn't on any Docker bridge network. Reach it via the host's LAN IP and `FETCHARR_PORT` instead.

## Ad detection is cutting the wrong things (or missing breaks)

- Commercial detection is heuristic and never perfect. Comskip's accuracy on AU free-to-air varies noticeably by channel (logo detection, silence thresholds, break lengths all differ).
- Run the show in `DETECT` mode first and check the reported break counts and minutes on the Recordings tab before switching to `CUT`. Scans are CPU-bound: budget ~30 minutes per 75-minute recording on NAS-class hardware.
- Cuts snap to keyframes, so a second or two of slop either side of a break is expected.
- To tune detection, place your own `comskip.ini` in the `/config` bind mount; it overrides the bundled AU-tuned default. Every cut keeps a `<file>.ts.orig` backup for the retention window, so a bad cut is recoverable by renaming the `.orig` back. See [Ad removal](/guide/ad-removal).

## Timestamps show the wrong time

- Set `TZ` in your `.env` to your IANA zone; the UI renders every timestamp in the container's zone, whatever device you're browsing from.

## Permission errors writing to `/config` or `/media/tv`

- Set `PUID`/`PGID` to match the owner of the bind-mounted host folders.
