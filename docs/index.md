---
layout: home

hero:
  name: Fetcharr
  text: >-
    Fetch TV recordings in&nbsp;Plex, ad&nbsp;free.<span style="font-size:0.8em;position:relative;line-height:0;top:-0.2em;left:-0.2em;">*</span>
  tagline: >-
    A self-hosted bridge for Australian Fetch TV DVB‑T boxes. It watches the box
    on your LAN, downloads new episodes of the shows you follow, optionally
    removes ads, transfers them into your Plex TV library, and pokes Plex to
    scan.<br><span style="font-size:0.575em;color:var(--vp-c-text-3)">*optional
    via <code>comskip</code></span>
  image:
    src: /logo.svg
    alt: Fetcharr
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What it is
      link: /guide/
    - theme: alt
      text: Technical deep dive
      link: /deep-dive

features:
  - title: TV Guide
    details: >-
      A 7-day programme guide in the browser: schedule, cancel, and
      series-record on the box, with pinned favourite channels (no Fetch
      mobile app needed).
    link: /guide/tv-guide
    linkText: Browse and record
  - title: Per-show follow
    details: >-
      Pick a Fetch show, fuzzy-match it to a folder under your media root, set a
      season template, and Fetcharr syncs new episodes on the schedule you choose.
    link: /guide/getting-started
    linkText: Set it up
  - title: Truncation-aware downloads
    details: >-
      Refuses to grab a half-recorded show, resumes interrupted downloads with
      HTTP Range, and holds a short file as partial until the next sync completes it.
    link: /deep-dive#sync-state-machine
    linkText: The state machine
  - title: Plex integration
    details: >-
      Refreshes the library section after any sync that downloaded something, with
      a Refresh Plex now button when you want it sooner.
    link: /guide/plex
    linkText: Set up Plex
  - title: Optional ad removal
    details: >-
      <code>comskip</code> commercial detection with a detect-only audit mode and
      keyframe stream-copy cutting (no transcode), keeping an .orig backup of
      every cut.
    link: /deep-dive#ad-removal
    linkText: How it works
  - title: Live operation progress
    details: >-
      Downloads, ad scans, and cuts report inline in the Recordings tab; the list
      polls every 2 seconds while anything is active, then falls back to idle.
    link: /deep-dive#live-progress-indicators
    linkText: The design
  - title: Authless LAN service
    details: >-
      SQLite-backed, single Docker container, no external runtime dependencies.
      CSRF, rate limiting, and a strict CSP, built for a trusted home network.
    link: /deep-dive#security-model
    linkText: The security model
---

> [!IMPORTANT]<br>
> In September 2026 Fetch TV announced a [Gen 3 Extended Service Levy](https://news.fetchtv.com.au/extended-service-levy-1): owners of a Mini Gen 3 or Mighty Gen 3 box with no subscription will be charged `$29.99` to keep the box working until `31 October 2027`, auto-charged to the card on file on `1 November 2026`, unless they act by `31 October 2026`, and a suspended Mighty Gen 3 account loses the ability to make or view recordings. The alternative Fetch offers is a new box plus a `$4.99/month` Fetch Access subscription. Fetch's guide and scheduling APIs are cloud-only and the box doesn't use the free over-the-air guide, so a tool bound to Fetch has no future.\
> \
> The successor to Fetcharr is [`freetvarr`](https://github.com/furey/freetvarr). It's the same app, but recording free-to-air with a [HDHomeRun tuner](https://shop.silicondust.com/shop/product/hdfx-4dt/) and [TVHeadend](https://docs.linuxserver.io/images/docker-tvheadend/) instead of Fetch TV.\
> \
> Still on a Fetch box? Use [`fetchtv`](https://github.com/furey/fetchtv) to copy your recordings off before `1 November 2026`.
