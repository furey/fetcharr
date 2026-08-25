---
title: TV Guide
description: >-
  A 7-day programme guide in the browser — schedule, cancel, and series-record
  on the Fetch box without the Fetch mobile app.
---

# TV Guide

The TV Guide tab is a 7-day programme guide for your Fetch box, in the browser. Click a programme to record it, cancel it, or set a series recording; the command goes to the box through Fetch's cloud service, the same way the official Fetch mobile app does it. Combined with [following shows](/guide/following-shows), the loop closes: schedule a series here, and Fetcharr downloads each episode into Plex as it lands on the box.

![The TV Guide tab](../img/screenshot-guide.png)

## Setup

The guide needs your Fetch cloud login — the same activation code and PIN that [Delete from Fetch](/guide/delete-from-fetch) uses. Enter both under Settings → Fetch Cloud and press `TEST CONNECTION`. The activation code (your Fetch ID) is on the box under `Menu → Manage → Settings → Device Info`, or at `fetchtv.com.au` under "Where's my code".

## The grid

Channels run down the page, time runs across, and a magenta line marks now. The guide opens scrolled to the current half hour.

- **Day chips** switch between today and the next six days; `NOW` and `TONIGHT` jump within the day.
- **Search** covers the full 7 days across every channel; results record straight from the list.
- Cell borders show recording state: blue for scheduled, gold for a series recording, pulsing magenta for recording right now.
- The status line above the grid reports the box (online or standby), the scheduled count, and the tuner limit.

## Recording a programme

Click a cell to open its detail: synopsis, rating, season and episode, and the channel artwork. From there:

- **RECORD** schedules the single airing. `START EARLY` and `RUN LATE` pad the timer (3 and 5 minutes by default) so late-running broadcasts don't clip.
- **RECORD SERIES** sets a series tag on the box, with an episodes-to-keep option.
- A scheduled programme shows **CANCEL RECORDING** instead.

The **UPCOMING** view lists everything scheduled on the box with cancel buttons; **SERIES** lists the box's series tags.

## Pinned channels

Press the ★ next to a channel in the rail to pin it. Pinned channels sit at the top of the grid in your order, with a gold tint; drag the `⠿` handle to reorder them, or use the arrows in the `CHANNELS` dialog.

`CHANNELS` also hides channels you never watch (a pinned channel can't be hidden — pinning unhides it) and sorts the unpinned rest by box order, channel number, or name.

## On the dashboard

With the cloud connection configured, the dashboard gains a TV Guide panel: what's on now across your pinned channels (with a progress bar through each programme), what's on next, and the next few scheduled recordings.

## When the box is asleep

Guide data comes from Fetch's cloud, so browsing keeps working while the box is in standby (Fetcharr remembers the channel lineup). Scheduling and cancelling need the box reachable; if a command times out, wake the box (or open it in the Fetch mobile app) and retry.

> [!NOTE]<br>
> The guide talks to the same unofficial cloud API as the official Fetch apps. If Fetch changes that API, the guide can stop working until Fetcharr is updated.
