# Plainify lexicon — fetcharr

Jargon-to-plain decisions for this project. Read before a run, extend after.
The docs site is split: `guide/` pages and the repo `README.md` are `docs`
preset for a new user (a self-hoster who can run Docker but is new to Fetch TV →
Plex); `docs/DEEP_DIVE.md` and `reference/` stay the technical companion and
keep their jargon.

| Term | Plain form | Policy | Reader / preset | Note |
| --- | --- | --- | --- | --- |
| PVR | the box that records your TV | gloss | self-hoster / docs | gloss once, then "the box" |
| DVB-T | free-to-air digital TV (over an aerial) | gloss | self-hoster / docs | |
| EPG | the on-screen TV guide | gloss | self-hoster / docs | keep "EPG" after glossing |
| SSDP / UPnP | the announcement devices broadcast so others can find them | gloss | self-hoster / docs | keep the term; it's the subject of the discovery troubleshooting |
| multicast | a message sent to everything on the local network at once | gloss | self-hoster / docs | explains why host networking is needed |
| broadcast domain | the same stretch of your network | strip | self-hoster / docs | |
| GDM | Plex's own way of announcing itself on the network | gloss | self-hoster / docs | |
| DLNA | the standard the box serves its files over | gloss | self-hoster / docs | |
| comskip | the ad-detection tool | gloss | self-hoster / docs | keep the name; it's the subject |
| keyframe stream-copy | copies the video across untouched, without re-encoding | gloss | self-hoster / docs | |
| remuxer / transcoder | converter | strip | self-hoster / docs | |
| re-encode | rebuild the video from scratch | gloss | self-hoster / docs | |
| `.ts` | the raw broadcast format | gloss | self-hoster / docs | keep the extension |
| HTTP Range | picks up from where it stopped | gloss | self-hoster / docs | keep the parenthetical term once |
| truncation / truncated | cut short / an incomplete file | strip | self-hoster / docs | |
| cron / cron expression | a schedule (the `* * * * *` timing string) | gloss | self-hoster / docs | keep every literal cron string |
| fuzzy-match | match by name even when the names aren't identical | strip | self-hoster / docs | |
| datalist | a dropdown of suggestions | strip | self-hoster / docs | |
| tombstone | a struck-through, dimmed row for a recording deleted from the box | gloss | self-hoster / docs | keep as the concept/heading |
| pills | labels | strip | self-hoster / docs | |
| niced | run at low priority | gloss | self-hoster / docs | |
| CPU-bound | works the CPU hard | strip | self-hoster / docs | |
| NAS-class hardware | a home NAS | strip | self-hoster / docs | |
| heuristic | educated guessing, never perfect | strip | self-hoster / docs | |
| housekeeping / auto-prune | routine cleanup / trims itself | strip | self-hoster / docs | |
| state database | its database | strip | self-hoster / docs | |
| migrations | database updates | gloss | self-hoster / docs | |
| no-op | does nothing | strip | self-hoster / docs | |
| sentinels | the tell-tale values | strip | self-hoster / docs | README only |
| HEAD-probes | double-checks with a quick request | strip | self-hoster / docs | README only |
| I_AM_ALIVE / ARE_YOU_ALIVE handshake | a wake-up ping and its reply | gloss | self-hoster / docs | keep the literal strings; they're the error text |
| CSRF / CSP / rate-limiting | keep, with a short gloss | gloss | self-hoster / docs | keep the acronyms; gloss the phrase once |
| Docker / Compose / container / bind mount / host networking / env var / token | — | keep | self-hoster / docs | option A: reader knows self-hosting; leave as-is |

## Voice notes
- Guide pages and README: short-ish sentences, Australian, gloss the TV/Fetch/video/comskip jargon on first use then use the plain form. Say why a step matters, not just what to do.
- Keep every command, path, filename, env var, cron string, status value, and cross-reference byte-for-byte. Only prose changes.
- Reader knows self-hosting (Docker, Compose, LAN, ports, git); don't gloss those.
- Never invite "open an issue/PR" (furey repos use Discussions only).
