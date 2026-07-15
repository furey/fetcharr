---
layout: home

hero:
  name: fetcharr
  text: Fetch TV recordings, in Plex.
  tagline: >-
    A self-hosted bridge for Australian Fetch TV DVB-T boxes. It watches the box
    on your LAN, downloads new episodes of the shows you follow, files them into
    your Plex TV library, and pokes Plex to scan.
  image:
    src: /logo.svg
    alt: fetcharr
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
  - title: Plex integration
    details: >-
      Refreshes the library section after any sync that downloaded something, with
      a Refresh Plex now button when you want it sooner.
  - title: Optional ad removal
    details: >-
      comskip commercial detection with a detect-only audit mode and keyframe
      stream-copy cutting (no transcode), keeping an .orig backup of every cut.
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
