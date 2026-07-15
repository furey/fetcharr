---
title: Delete from Fetch
description: >-
  Optional delete-from-box after Plex confirms the file, via the Fetch cloud API.
---

# Delete from Fetch

Once Plex confirms an episode, the copy on the Fetch box is dead weight. Fetcharr can delete it to free space, but only after Plex has the file. It's optional and stays off unless you configure a Fetch cloud account.

## Why the cloud

The box's LAN-side delete is broken: the firmware advertises the action but rejects the request. So deletion goes through Fetch's cloud API with your account credentials. The full rationale is in the [deep dive](/deep-dive#why-delete-from-fetch-goes-through-the-cloud-not-lan).

## Set it up

In Settings → Fetch Cloud (or the wizard's Fetch Cloud step), enter your activation code and PIN, run TEST CONNECTION, then pick your box as the Terminal ID. These are your Fetch account credentials, stored in the state database.

## When it deletes

A delete is queued only after Plex confirms the downloaded file. For a `CUT`-mode show it also waits for the cut to verify, so the box keeps the pristine source if a cut fails ([Ad removal](/guide/ad-removal)). Deleted recordings show as tombstones in [Recordings](/guide/recordings).

## If a delete fails

A box whose cloud session has gone to sleep can miss the wake-up ping even though it answers fine on the LAN. Fetcharr pings twice before giving up, and the first attempt usually wakes the session, so retry the delete after a moment. If it keeps failing, check the box is visible in the official Fetch mobile app (same cloud path); if the app can't see it either, the box↔cloud link is down and a box restart usually resets it. More in [Troubleshooting](/guide/troubleshooting#delete-from-fetch-fails).
