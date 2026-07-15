---
title: Syncs
description: >-
  Scheduled and manual sync passes over the Fetch box, and the history of what
  each one did.
---

# Syncs

A sync is one pass over the Fetch box: browse its listings, match them against your followed shows, download anything new, then refresh Plex if something landed. The Syncs tab is the history of those passes.

![The Syncs tab](../img/screenshot-syncs.png)

## Scheduled and manual

Set a cron expression in Settings and the scheduler polls the box on that schedule; changing the cron reloads the scheduler without a restart. You can also Sync now globally (every enabled show) or per-show from the [Shows tab](/guide/following-shows).

## Reading a sync

Each row shows what the pass did: downloads, failures, deletes, or nothing (empty). A sync is marked `ok` unless something failed. A truncation (a `partial` recording) is counted as a failure rather than a skip, so it's visible at a glance instead of hiding in the noise.

## History

Sync history auto-prunes to the latest 500 rows. Clear individual rows or the whole history from the tab, and filter by activity: `DOWNLOADS` / `FAILS` / `DELETES` / `EMPTY`.
