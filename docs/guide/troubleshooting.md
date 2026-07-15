---
title: Troubleshooting
description: Fixes for the common snags — discovery, Plex, downloads, deletes, ad detection.
---

# Troubleshooting

## Auto-discover can't find the Fetch box

- The container has to run with host networking (the example compose already does this). Fetcharr finds the box by listening for the announcement it broadcasts on your network (a protocol called SSDP), and those broadcasts don't reach across Docker's own private network, so the container has to share the host's network to hear them.
- The host has to be on the same part of the network as the box; those broadcasts don't cross between subnets without extra setup.
- You can always enter the box's IP and port manually in Settings instead.

## Plex token auto-detect fails

- It needs Plex's `Preferences.xml` bind-mounted into the container (`PLEX_PREFS_PATH`), which only works when Plex runs on the same host.
- Paste the token manually instead; grab it from `app.plex.tv` (or Plex's own support article on finding your token). See [Plex](/guide/plex).

## An episode was skipped with "currently recording"

- That's deliberate: Fetch reports the wrong file size while a recording is still going, so Fetcharr refuses to download it rather than save an incomplete file. It syncs on the next run after the recording finishes.

## A recording shows `partial`

- The download came up short of the size Fetch reported. The next sync picks up from where it stopped (using HTTP range requests), so a `partial` normally sorts itself out.

## Delete-from-Fetch fails {#delete-from-fetch-fails}

Symptoms: "No I_AM_ALIVE reply" or "Timed out waiting for I_AM_ALIVE handshake".

- The reply comes from your Fetch box via Fetch's cloud, and a box whose cloud session has dozed off misses the ping even though it works fine on the LAN. Fetcharr pings twice (20 s) before giving up, and the first attempt usually wakes the box's session, so just retry the delete after a moment.
- If it keeps failing, open the official Fetch mobile app: if the app can't see the box either, the box↔cloud link is down; restarting the box resets it. See [Delete from Fetch](/guide/delete-from-fetch) and the [deep dive](/deep-dive#why-delete-from-fetch-goes-through-the-cloud-not-lan).

## Other containers can't reach Fetcharr by name

- A side-effect of host networking: Fetcharr isn't on any Docker bridge network. Reach it via the host's LAN IP and `FETCHARR_PORT` instead.

## Ad detection is cutting the wrong things (or missing breaks)

- Ad detection is educated guessing, never perfect. Comskip's accuracy on Australian free-to-air varies a lot by channel (logo detection, silence thresholds, and break lengths all differ).
- Run the show in `DETECT` mode first and check the break counts and minutes it reports on the Recordings tab before switching to `CUT`. Scans work the CPU hard: budget ~30 minutes per 75-minute recording on a home NAS.
- Cuts land on the nearest keyframe, so a second or two either side of a break is normal.
- To tune detection, place your own `comskip.ini` in the `/config` bind mount; it overrides the bundled Australian-tuned default. Every cut keeps a `<file>.ts.orig` backup for the retention window, so if a cut goes wrong you can rename the `.orig` back to recover it. See [Ad removal](/guide/ad-removal).

## Timestamps show the wrong time

- Set `TZ` in your `.env` to your IANA timezone; the UI shows every timestamp in the container's zone, whatever device you're browsing from.

## Permission errors writing to `/config` or `/media/tv`

- Set `PUID`/`PGID` to match the owner of the bind-mounted host folders.
