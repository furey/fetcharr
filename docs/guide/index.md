---
title: What Fetcharr is
description: >-
  Fetcharr is a self-hosted bridge that syncs Fetch TV PVR recordings into Plex,
  named and foldered, on your LAN.
---

# What Fetcharr is

Your Fetch TV box records the shows you tell it to, then the recordings sit on the box, watchable only through Fetch's own interface. Fetcharr watches the box on your LAN, downloads new episodes of shows you mark to follow, drops the files into your Plex TV library, pokes Plex to scan, and optionally deletes the recording from the Fetch box once Plex confirms the file.

If your media stack is Fetch TV → Plex, Fetcharr is the automation in between: schedule recordings on the box as usual, and they turn up in Plex named and foldered.

![The Fetcharr dashboard](../img/screenshot-dashboard.png)

Ready to run it? Head to [Getting started](/guide/getting-started). Want the mechanics; the sync state machine, the delete-from-cloud rationale, the ad-removal pipeline? That's the [Technical deep dive](/deep-dive).

## What Fetcharr isn't

- **Not an indexer integration** (Sonarr / Radarr / Prowlarr). Fetcharr only consumes what Fetch has already recorded; it doesn't tell Fetch what to record. Use the box's own EPG to schedule recordings.
- **Not authenticated.** It's designed for trusted LAN deployments. CSRF, rate-limiting, and a strict CSP are in place, but there's no login. Don't expose it to the internet; see the [security model](/deep-dive#security-model).
- **Not a remuxer or transcoder.** Files land as `.ts` from the box and stay `.ts`. The optional ad-cutting is a keyframe stream-copy, not a re-encode. Add Tdarr or similar downstream if you need `.mkv`.
- **Not a notifier.** No Discord / ntfy / push integration.

> [!IMPORTANT]<br>
> Tested against a Fetch TV Mighty 3 and Plex Media Server. Other Fetch hardware and firmware are unverified.

## What you get

- **Zero-config discovery** of the Fetch box (SSDP) and Plex server (GDM) on the LAN, plus Plex-token auto-detection from a bind-mounted `Preferences.xml`.
- **A first-run wizard** that walks Fetch box → storage → Plex → optional Fetch Cloud, re-openable any time from Settings.
- **Per-show follow** with fuzzy folder matching and a season-folder template.
- **Scheduled and manual sync**: cron-configurable polling, plus on-demand global or per-show Sync now.
- **In-progress recording protection**: Fetcharr catches Fetch's misleading live-record sizes so you never save a truncated file.
- **Resumable, truncation-aware downloads** with HTTP Range resume across syncs.
- **Optional delete-from-Fetch** once Plex confirms the file, freeing space on the box.
- **Optional ad removal**: comskip detection with a detect-only audit mode and keyframe stream-copy cutting.
- **Live operation progress** for downloads, ad scans, and cuts, inline in the Recordings tab.
- **A phone-friendly UI**: every view adapts below tablet width, so checking a sync from the couch works as well as from a desk.

<div class="fetcharr-mobile-shots">

![Dashboard on a phone](../img/screenshot-mobile-dashboard.png)
![Shows on a phone](../img/screenshot-mobile-shows.png)
![Recordings on a phone](../img/screenshot-mobile-recordings.png)

</div>

<style>
.fetcharr-mobile-shots {
  display: flex;
  gap: 12px;
  margin-top: 1.5rem;
}
.fetcharr-mobile-shots img {
  width: 33%;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
}
</style>
