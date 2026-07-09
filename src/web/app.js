import {
  createApp,
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
} from '/vendor/vue.esm-browser.prod.js'

let csrfToken = null

const getCsrf = async ({ force = false } = {}) => {
  if (csrfToken && !force) return csrfToken
  const res = await fetch('/api/csrf-token')
  if (!res.ok) throw new Error(`csrf-token HTTP ${res.status}`)
  const data = await res.json().catch(() => {
    throw new Error(`csrf-token returned non-JSON (HTTP ${res.status})`)
  })
  csrfToken = data.token
  return csrfToken
}

const apiCall = async (method, url, body, headersExtra = {}) => {
  const headers = { 'Content-Type': 'application/json', ...headersExtra }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || data.reason || `HTTP ${res.status}`)
  return data
}

const api = async (method, url, body) => {
  if (method === 'GET') return apiCall(method, url, body)
  try {
    return await apiCall(method, url, body, { 'x-csrf-token': await getCsrf() })
  } catch (err) {
    if (!/HTTP 403/.test(err.message)) throw err
    csrfToken = null
    return apiCall(method, url, body, { 'x-csrf-token': await getCsrf({ force: true }) })
  }
}

const fmtBytes = (n) => {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = Number(n)
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

const tz = ref('UTC')

const fmtTime = (s) => {
  if (!s) return ''
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  return new Date(iso).toLocaleString('en-AU', { timeZone: tz.value, hour12: true })
}

const fmtTimeShort = (s) => {
  if (!s) return ''
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: tz.value,
    hour12: true,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const plexSummary = (p) => {
  if (p.triggered) return `plex ✓ (${p.status})`
  if (p.skipped) return 'plex —'
  if (p.error) return `plex ✗ ${p.error}`
  return 'plex ?'
}

const deleteSummary = (d) => {
  if (d.triggered) return `del ✓ ${d.deleted?.length ?? '?'}`
  if (d.skipped) return `del — ${d.reason || ''}`.trim()
  if (d.error) return `del ✗ ${d.error}`
  return 'del ?'
}

const adsSummary = (a) => {
  const bits = []
  if (a.detected) bits.push(`${a.detected} detected`)
  if (a.cut) bits.push(`${a.cut} cut`)
  if (a.failed) bits.push(`${a.failed} failed`)
  return `ads ${bits.length ? bits.join(' · ') : `${a.scanned} scanned`}`
}

const triggerMeta = (t) => {
  if (t === 'cron') return { kind: 'trigger-cron', title: 'Cron-scheduled sync' }
  if (t === 'manual-single') return { kind: 'trigger-manual', title: 'Manual single-show sync' }
  if (t === 'manual') return { kind: 'trigger-manual', title: 'Manual full sync' }
  return { kind: 'text', text: t }
}

const summaryParts = (s) => {
  if (!s) return []
  const parts = []
  if (s.trigger) parts.push(triggerMeta(s.trigger))
  if (s.downloaded !== undefined) parts.push({ kind: 'download', text: String(s.downloaded) })
  if (s.skipped !== undefined) parts.push({ kind: 'text', text: `skip ${s.skipped}` })
  if (s.failed) parts.push({ kind: 'text', text: `fail ${s.failed}` })
  if (s.plex) parts.push({ kind: 'text', text: plexSummary(s.plex) })
  if (s.delete) parts.push({ kind: 'text', text: deleteSummary(s.delete) })
  if (s.ads) parts.push({ kind: 'text', text: adsSummary(s.ads) })
  if (s.message) parts.push({ kind: 'text', text: s.message })
  if (s.errors?.length) {
    const tail = s.errors.length > 2 ? '…' : ''
    parts.push({ kind: 'text', text: `errors: ${s.errors.slice(0, 2).join('; ')}${tail}` })
  }
  return parts
}

const SummaryLine = {
  props: ['summary'],
  computed: {
    parts() { return summaryParts(this.summary) }
  },
  template: `
    <code v-if="parts.length" class="inline-flex items-center gap-1.5 flex-wrap align-middle">
      <template v-for="(p, i) in parts" :key="i">
        <span v-if="i > 0" class="text-ink-mute">·</span>
        <span v-if="p.kind === 'trigger-cron'" class="inline-flex items-center align-middle text-ink-dim" :title="p.title" :aria-label="p.title">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 align-middle" aria-hidden="true">
            <circle cx="8" cy="8" r="5.75"/>
            <path d="M8 5v3.25l2.25 1.5"/>
          </svg>
        </span>
        <span v-else-if="p.kind === 'trigger-manual'" class="inline-flex items-center align-middle text-ink-dim" :title="p.title" :aria-label="p.title">
          <svg viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 align-middle" aria-hidden="true">
            <path d="M5 3.5v9a0.5 0.5 0 0 0 0.78 0.42l6.8-4.5a0.5 0.5 0 0 0 0-0.84l-6.8-4.5A0.5 0.5 0 0 0 5 3.5z"/>
          </svg>
        </span>
        <span v-else class="inline-flex items-center gap-1 align-middle">
          <svg v-if="p.kind === 'download'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 align-middle text-ink-dim" aria-hidden="true">
            <path d="M8 2.5v7.5M5 7l3 3 3-3M3 13.5h10"/>
          </svg>
          <span>{{ p.text }}</span>
        </span>
      </template>
    </code>
  `,
}

const makeStatus = () => {
  const text = ref('')
  const kind = ref('ok')
  const set = (msg, k = 'ok', ms = FLASH_DEFAULT_MS) => {
    text.value = msg
    kind.value = k
    if (ms > 0) setTimeout(() => (text.value = ''), ms)
  }
  const clear = () => (text.value = '')
  return [text, kind, set, clear]
}

const useFlash = () => {
  const flashText = ref('')
  const flashKind = ref('ok')
  const flash = ({ msg, kind = 'ok', ms = FLASH_DEFAULT_MS }) => {
    flashText.value = msg
    flashKind.value = kind
    if (ms > 0) setTimeout(() => (flashText.value = ''), ms)
  }
  const flashUntilSyncDone = ({ msg, kind = 'ok' }) => {
    flashText.value = msg
    flashKind.value = kind
    const ourMsg = msg
    const clearIfStillOurs = () => {
      if (flashText.value === ourMsg) flashText.value = ''
    }
    const stop = watch(() => syncStatus.value.activeSyncId, (curr, prev) => {
      if (!curr && prev) {
        clearIfStillOurs()
        stop()
      }
    })
    setTimeout(() => {
      clearIfStillOurs()
      stop()
    }, SYNC_FLASH_SAFETY_MS)
  }
  return { flashText, flashKind, flash, flashUntilSyncDone }
}

const FLASH_DEFAULT_MS = 4500
const SYNC_FLASH_SAFETY_MS = 60_000

const ROUTES = ['dashboard', 'shows', 'syncs', 'recordings', 'settings', 'welcome']
const WELCOME_DISMISSED_KEY = 'fetcharr.welcomeDismissed'
const DEFAULT_ROUTE = 'dashboard'

const DASHBOARD_POLL_MS = 30_000
const SYNCS_POLL_MS = 30_000
const RECORDINGS_POLL_MS = 60_000
const RECORDINGS_ACTIVE_POLL_MS = 2_000

const parseHash = () => {
  const h = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase()
  return ROUTES.includes(h) ? h : DEFAULT_ROUTE
}

const route = ref(parseHash())
window.addEventListener('hashchange', () => { route.value = parseHash() })

const syncStatus = ref({ activeSyncId: null, cron: '' })
let syncPollTimer = null

const fetchSyncStatus = async () => {
  try {
    syncStatus.value = await api('GET', '/api/sync-status')
  } catch {
    /* leave previous value */
  }
  return syncStatus.value
}

const stopSyncPolling = () => {
  if (syncPollTimer) clearInterval(syncPollTimer)
  syncPollTimer = null
}

const ensureSyncPolling = () => {
  if (syncPollTimer || !syncStatus.value.activeSyncId) return
  syncPollTimer = setInterval(async () => {
    await fetchSyncStatus()
    if (!syncStatus.value.activeSyncId) stopSyncPolling()
  }, 3000)
}

watch(() => syncStatus.value.activeSyncId, (curr) => {
  if (curr) ensureSyncPolling()
})

const FAVICON_SIZE = 32
const FAVICON_BG = '#28231b'
const FAVICON_CHIP_BASE_Y = 13
const FAVICON_CHIP_WIDTH = 8
const FAVICON_CHIP_HEIGHT = 6
const FAVICON_BOB_AMPLITUDE = 4
const FAVICON_BOB_PERIOD_MS = 900
const FAVICON_FRAME_INTERVAL_MS = 90
const FAVICON_CHIPS = [
  { x: 3,  color: '#009be4' },
  { x: 12, color: '#f10c69' },
  { x: 21, color: '#e2b03c' },
]

let faviconCanvas = null
let faviconCtx = null
let faviconLink = null
let faviconTimer = null
let faviconStart = 0

const ensureFaviconCanvas = () => {
  if (faviconCanvas) return
  faviconCanvas = document.createElement('canvas')
  faviconCanvas.width = FAVICON_SIZE
  faviconCanvas.height = FAVICON_SIZE
  faviconCtx = faviconCanvas.getContext('2d')
  faviconLink = document.querySelector('link[rel="icon"]')
}

const drawFaviconFrame = (now) => {
  const phase = ((now - faviconStart) / FAVICON_BOB_PERIOD_MS) * Math.PI * 2
  faviconCtx.fillStyle = FAVICON_BG
  faviconCtx.fillRect(0, 0, FAVICON_SIZE, FAVICON_SIZE)
  FAVICON_CHIPS.forEach((chip, index) => {
    const stagger = (index / FAVICON_CHIPS.length) * Math.PI * 2
    const offset = Math.sin(phase + stagger) * FAVICON_BOB_AMPLITUDE
    faviconCtx.fillStyle = chip.color
    faviconCtx.fillRect(chip.x, FAVICON_CHIP_BASE_Y - offset, FAVICON_CHIP_WIDTH, FAVICON_CHIP_HEIGHT)
  })
  faviconLink.href = faviconCanvas.toDataURL('image/png')
}

const startFaviconAnimation = () => {
  ensureFaviconCanvas()
  if (faviconTimer) return
  faviconStart = performance.now()
  faviconTimer = setInterval(() => drawFaviconFrame(performance.now()), FAVICON_FRAME_INTERVAL_MS)
}

const stopFaviconAnimation = () => {
  if (faviconTimer) {
    clearInterval(faviconTimer)
    faviconTimer = null
  }
  if (faviconLink) faviconLink.href = '/favicon.svg'
}

watch(() => syncStatus.value.activeSyncId, (curr) => {
  if (curr) startFaviconAnimation()
  else stopFaviconAnimation()
})

const now = ref(new Date())
setInterval(() => { now.value = new Date() }, 1000)

const clockReadout = computed(() => new Intl.DateTimeFormat('en-AU', {
  timeZone: tz.value,
  hour12: true,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}).format(now.value))

const tzShortName = computed(() => {
  try {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: tz.value,
      timeZoneName: 'short',
    }).formatToParts(now.value)
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz.value
  } catch {
    return tz.value
  }
})

const seasonEpisodeLabel = (r) => {
  if (r.season == null && r.episode == null) return ''
  const s = r.season != null ? `S${String(r.season).padStart(2, '0')}` : ''
  const e = r.episode != null ? `E${String(r.episode).padStart(2, '0')}` : ''
  return `${s}${e}`
}

const within7Days = (s) => {
  if (!s) return false
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && (Date.now() - t) < 7 * 24 * 60 * 60 * 1000
}

const DashboardView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">SYNC DECK</span>
          <span v-if="syncStatus.cron" class="text-xs font-mono text-ink-dim">CRON · <code>{{ syncStatus.cron }}</code></span>
        </header>
        <div class="panel-body grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div class="flex items-center gap-4 mb-3">
              <span :class="['led-dot', syncStatus.activeSyncId ? 'live' : 'idle']"></span>
              <span :class="['text-4xl', 'font-mono', 'tracking-[0.2em]', syncStatus.activeSyncId ? 'text-signal-magenta' : 'text-ink-dim']">
                {{ syncStatus.activeSyncId ? 'SYNC' : 'IDLE' }}
              </span>
              <span v-if="syncStatus.activeSyncId" class="font-mono text-sm text-ink-dim">
                · sync #{{ syncStatus.activeSyncId }} in progress
              </span>
            </div>
            <p v-if="lastSync" class="font-mono text-sm text-ink-dim">
              Last sync #{{ lastSync.id }}
              · <span :class="['pill', lastSync.status]">{{ lastSync.status }}</span>
              · {{ fmtTime(lastSync.started_at) }}
              <span v-if="lastSync.summary"> · <summary-line :summary="lastSync.summary"/></span>
            </p>
            <p v-else class="text-sm text-ink-dim">No syncs yet — kick one off.</p>
          </div>
          <div class="flex items-center gap-3 md:justify-self-end">
            <span v-if="flashText" :class="['status-readout', flashKind]">{{ flashText }}</span>
            <button type="button" class="btn btn-primary" @click="syncNow" :disabled="!!syncStatus.activeSyncId || starting">
              {{ starting ? 'STARTING…' : '▶ SYNC NOW' }}
            </button>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <a href="#/shows" class="panel p-5 block text-ink hover:text-ink no-hover-underline hover:border-signal-magenta transition-colors">
          <div class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim mb-2">Shows</div>
          <div class="text-4xl font-mono text-ink">{{ showCount }}</div>
          <div class="text-xs text-ink-dim mt-2">
            <span class="text-plex-yellow">{{ showEnabledCount }}</span> enabled
          </div>
        </a>
        <a href="#/recordings" class="panel p-5 block text-ink hover:text-ink no-hover-underline hover:border-signal-magenta transition-colors">
          <div class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim mb-2">Recordings 7d</div>
          <div class="text-4xl font-mono text-ink">{{ recordings7dCount }}</div>
          <div class="text-xs text-ink-dim mt-2">
            <span class="text-plex-yellow">{{ recordingsTotal }}</span> in window
          </div>
        </a>
        <article class="panel p-5">
          <div class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim mb-2">Fetch Cloud</div>
          <div class="text-lg font-mono" :class="cloudClass">{{ cloudLabel }}</div>
          <div v-if="cloudTerminalId" class="text-xs font-mono text-ink-dim mt-2 truncate">{{ cloudTerminalId }}</div>
        </article>
        <article class="panel p-5">
          <div class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim mb-2">Plex</div>
          <div class="text-lg font-mono" :class="plexClass">{{ plexLabel }}</div>
          <div v-if="plexHost" class="text-xs font-mono text-ink-dim mt-2 truncate">{{ plexHost }}</div>
        </article>
      </section>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">RECENT SYNCS</span>
          <a href="#/syncs" class="text-xs font-mono uppercase tracking-[0.16em]">See all →</a>
        </header>
        <div class="panel-body">
          <table v-if="recentSyncs.length" class="deck-table">
            <thead><tr>
              <th>Started</th><th>Status</th><th>Summary</th>
            </tr></thead>
            <tbody>
              <tr v-for="s in recentSyncs" :key="s.id" :class="{ active: s.id === syncStatus.activeSyncId }">
                <td class="font-mono">{{ fmtTime(s.started_at) }}</td>
                <td><span :class="['pill', s.status]">{{ s.status }}</span></td>
                <td><summary-line :summary="s.summary"/></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-ink-dim text-sm">No syncs yet.</p>
        </div>
      </section>
    </div>
  `,
  setup() {
    const { flashText, flashKind, flash, flashUntilSyncDone } = useFlash()
    const starting = ref(false)
    const recentSyncs = ref([])
    const showCount = ref(0)
    const showEnabledCount = ref(0)
    const recordingsTotal = ref(0)
    const recordings7dCount = ref(0)
    const plexHost = ref('')
    const plexConfigured = ref(false)
    const cloudTerminalId = ref('')
    const cloudConfigured = ref(false)

    const lastSync = computed(() => recentSyncs.value[0] || null)

    const plexLabel = computed(() => plexConfigured.value ? 'Connected' : 'Not configured')
    const plexClass = computed(() => plexConfigured.value ? 'text-plex-yellow' : 'text-ink-dim')

    const cloudLabel = computed(() => cloudConfigured.value ? 'Connected' : 'Not configured')
    const cloudClass = computed(() => cloudConfigured.value ? 'text-plex-yellow' : 'text-ink-dim')

    const refresh = async () => {
      const [syncs, shows, recordings, settings] = await Promise.all([
        api('GET', '/api/syncs').catch(() => ({ syncs: [] })),
        api('GET', '/api/shows').catch(() => ({ shows: [] })),
        api('GET', '/api/recordings').catch(() => ({ recordings: [] })),
        api('GET', '/api/settings').catch(() => ({})),
      ])
      recentSyncs.value = (syncs.syncs || []).slice(0, 5)
      showCount.value = shows.shows?.length || 0
      showEnabledCount.value = shows.shows?.filter((s) => s.enabled).length || 0
      recordingsTotal.value = recordings.recordings?.length || 0
      recordings7dCount.value = recordings.recordings?.filter((r) => within7Days(r.downloaded_at)).length || 0
      plexConfigured.value = Boolean(settings.plex_url && settings.plex_token_set && settings.plex_tv_section_id)
      try {
        plexHost.value = settings.plex_url ? new URL(settings.plex_url).host : ''
      } catch {
        plexHost.value = settings.plex_url || ''
      }
      cloudConfigured.value = Boolean(
        settings.fetch_cloud_activation_code
        && settings.fetch_cloud_pin_set
        && settings.fetch_cloud_terminal_id,
      )
      cloudTerminalId.value = settings.fetch_cloud_terminal_id || ''
    }

    const syncNow = async () => {
      starting.value = true
      try {
        const r = await api('POST', '/api/sync')
        if (r.alreadyRunning) flash({ msg: 'A sync is already running.', kind: 'info' })
        else flashUntilSyncDone({ msg: `Started sync #${r.syncId}.` })
        await fetchSyncStatus()
        ensureSyncPolling()
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        starting.value = false
      }
    }

    let pollTimer = null
    onMounted(() => {
      refresh()
      pollTimer = setInterval(refresh, DASHBOARD_POLL_MS)
    })
    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer)
    })
    const stopWatch = watch(() => syncStatus.value.activeSyncId, refresh)
    onUnmounted(stopWatch)

    return {
      syncStatus, lastSync, recentSyncs,
      showCount, showEnabledCount, recordingsTotal, recordings7dCount,
      plexLabel, plexClass, plexHost,
      cloudLabel, cloudClass, cloudTerminalId,
      starting, syncNow, fmtTime,
      flashText, flashKind,
    }
  },
}

const ShowsView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">SHOWS · {{ shows.length }}</span>
          <span v-if="flashText" :class="['status-readout', flashKind]">{{ flashText }}</span>
        </header>
        <div class="panel-body">
          <table v-if="shows.length" class="deck-table">
            <thead><tr>
              <th>Show pattern</th>
              <th>Destination</th>
              <th>Season template</th>
              <th>Enabled</th>
              <th title="Delete from Fetch after each successful download (cloud delete).">Delete after DL</th>
              <th title="Detect = report ad breaks only; Cut = remove them from the file (keeps a .orig backup).">Ad removal</th>
              <th></th>
            </tr></thead>
            <tbody>
              <tr v-for="s in shows" :key="s.id">
                <td class="font-mono text-ink">{{ s.fetch_show_pattern }}</td>
                <td><code>{{ s.dest_folder }}</code></td>
                <td><code>{{ s.season_template }}</code></td>
                <td>
                  <input type="checkbox" class="chk" :checked="s.enabled" @change="toggle(s, $event.target.checked)" />
                </td>
                <td>
                  <input type="checkbox" class="chk" :checked="s.delete_after_download" @change="toggleDeleteAfter(s, $event.target.checked)" />
                </td>
                <td>
                  <select class="field-input" style="width: auto; padding-top: 0.3rem; padding-bottom: 0.3rem;"
                    :value="s.ad_removal" :disabled="!adRemovalEnabled"
                    :title="adRemovalEnabled ? '' : 'Enable ad removal in Settings first.'"
                    @change="setAdRemoval(s, $event.target.value)">
                    <option value="off">OFF</option>
                    <option value="detect">DETECT</option>
                    <option value="cut">CUT</option>
                  </select>
                </td>
                <td>
                  <div class="flex items-center gap-2 flex-wrap">
                    <button type="button" class="btn" @click="syncOne(s)"
                      :disabled="!s.enabled || syncingId === s.id"
                      :title="s.enabled ? 'Sync just this show now' : 'Enable to sync'">
                      {{ syncingId === s.id ? 'STARTING…' : '▶ SYNC' }}
                    </button>
                    <button type="button" class="btn btn-danger" @click="remove(s)">DELETE</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-ink-dim text-sm">
            No shows yet — add one below to start tracking a show.
          </p>
        </div>
      </section>

      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">ADD SHOW</span>
        </header>
        <form class="panel-body" @submit.prevent="add">
          <div class="grid gap-4 md:grid-cols-2">
            <div class="field-row">
              <label class="field-label">Fetch show pattern (case-insensitive substring)</label>
              <div class="flex items-center gap-2">
                <input type="text" v-model="newPattern" list="fetch-shows" placeholder="e.g. Bluey" class="field-input flex-1" />
                <button type="button" class="btn btn-sm" @click="loadFetchShows" :disabled="loadingShows"
                  title="Browse the Fetch TV box to populate this dropdown with current show titles.">
                  {{ loadingShows ? 'BROWSING…' : '↻ REFRESH SHOWS' }}
                </button>
              </div>
              <datalist id="fetch-shows">
                <option v-for="fs in fetchShows" :key="fs.id" :value="fs.title" />
              </datalist>
            </div>
            <div class="field-row">
              <label class="field-label">Destination folder under <code>{{ mediaRoot || '/media/tv' }}</code></label>
              <input type="text" v-model="newFolder" list="media-folders" placeholder="e.g. Bluey (2018)" class="field-input" />
              <datalist id="media-folders">
                <option v-for="d in folders" :key="d" :value="d" />
              </datalist>
              <p v-if="suggestion" class="text-xs text-ink-dim mt-2">
                Suggested ({{ suggestionIsNew ? 'new folder' : 'existing' }}):
                <code>{{ suggestion }}</code>
                <button type="button" class="btn-link" @click="newFolder = suggestion">use</button>
              </p>
            </div>
            <div class="field-row">
              <label class="field-label">Season template</label>
              <input type="text" v-model="newTemplate" placeholder="Season {season}" class="field-input" />
            </div>
            <div class="field-row">
              <span class="field-label">Auto-delete</span>
              <label class="flex items-center gap-3 cursor-pointer h-[2.5rem]">
                <input id="new-del-after" type="checkbox" class="chk" v-model="newDeleteAfter" />
                <span class="font-mono text-sm text-ink-dim">
                  Delete from Fetch after each successful download
                </span>
              </label>
            </div>
            <div class="field-row">
              <label class="field-label">Ad removal</label>
              <select class="field-input" v-model="newAdRemoval" :disabled="!adRemovalEnabled">
                <option value="off">OFF</option>
                <option value="detect">DETECT — report ad breaks only</option>
                <option value="cut">CUT — remove ad breaks (keeps .orig backup)</option>
              </select>
              <p v-if="!adRemovalEnabled" class="text-xs text-ink-mute mt-2">
                Enable ad removal in Settings to use this.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3 mt-2">
            <button type="submit" class="btn btn-primary" :disabled="adding">
              {{ adding ? 'ADDING…' : '＋ ADD SHOW' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  `,
  setup() {
    const { flashText, flashKind, flash, flashUntilSyncDone } = useFlash()
    const shows = ref([])
    const fetchShows = ref([])
    const folders = ref([])
    const newPattern = ref('')
    const newFolder = ref('')
    const newTemplate = ref('Season {season}')
    const newDeleteAfter = ref(false)
    const newAdRemoval = ref('off')
    const suggestion = ref('')
    const suggestionIsNew = ref(false)
    const adding = ref(false)
    const loadingShows = ref(false)
    const syncingId = ref(null)
    const mediaRoot = ref('')
    const fetchIpSet = ref(false)
    const adRemovalEnabled = ref(false)

    const refresh = async () => {
      const r = await api('GET', '/api/shows')
      shows.value = r.shows
    }

    const loadStorageHint = async () => {
      const s = await api('GET', '/api/settings').catch(() => ({}))
      mediaRoot.value = s.media_root || ''
      fetchIpSet.value = Boolean(s.fetch_ip)
      adRemovalEnabled.value = Boolean(s.ad_removal_enabled)
    }

    const suggestFor = async (pattern) => {
      const trimmed = (pattern || '').trim()
      if (trimmed.length < 2) {
        suggestion.value = ''
        suggestionIsNew.value = false
        return
      }
      try {
        const r = await api('GET', `/api/folder-suggest?show=${encodeURIComponent(trimmed)}`)
        folders.value = r.folders || []
        if (r.match?.folder) {
          suggestion.value = r.match.folder
          suggestionIsNew.value = false
        } else {
          suggestion.value = trimmed
          suggestionIsNew.value = true
        }
      } catch {
        suggestion.value = trimmed
        suggestionIsNew.value = true
      }
    }

    let debounceTimer = null
    watch(newPattern, (v) => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => suggestFor(v), 250)
    })

    onMounted(async () => {
      await Promise.all([refresh(), loadStorageHint()])
      if (shows.value.length === 0 && fetchIpSet.value && !loadingShows.value) {
        await loadFetchShows()
      }
    })

    const add = async () => {
      if (!newPattern.value.trim() || !newFolder.value.trim()) {
        flash({ msg: 'Pattern and folder are required.', kind: 'err', ms: 5000 })
        return
      }
      adding.value = true
      try {
        await api('POST', '/api/shows', {
          fetch_show_pattern: newPattern.value.trim(),
          dest_folder: newFolder.value.trim(),
          season_template: newTemplate.value.trim() || 'Season {season}',
          delete_after_download: newDeleteAfter.value === true,
          ad_removal: newAdRemoval.value,
        })
        newPattern.value = ''
        newFolder.value = ''
        newTemplate.value = 'Season {season}'
        newDeleteAfter.value = false
        newAdRemoval.value = 'off'
        suggestion.value = ''
        await refresh()
        flash({ msg: 'Added.' })
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        adding.value = false
      }
    }

    const toggle = async (s, enabled) => {
      try {
        await api('PATCH', `/api/shows/${s.id}`, { enabled })
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    const toggleDeleteAfter = async (s, delete_after_download) => {
      try {
        await api('PATCH', `/api/shows/${s.id}`, { delete_after_download })
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    const setAdRemoval = async (s, ad_removal) => {
      try {
        await api('PATCH', `/api/shows/${s.id}`, { ad_removal })
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    const remove = async (s) => {
      if (!confirm(`Delete show "${s.fetch_show_pattern}"?`)) return
      try {
        await api('DELETE', `/api/shows/${s.id}`)
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    const loadFetchShows = async () => {
      loadingShows.value = true
      flash({ msg: 'Browsing Fetch TV (can take a few seconds)…', kind: 'info', ms: 0 })
      try {
        const r = await api('POST', '/api/fetch-shows')
        fetchShows.value = r.shows
        flash({ msg: `Found ${r.shows.length} shows.`, ms: 5000 })
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        loadingShows.value = false
      }
    }

    const syncOne = async (s) => {
      syncingId.value = s.id
      try {
        const r = await api('POST', '/api/sync', { show_id: s.id })
        if (r.alreadyRunning) flash({ msg: 'A sync is already running.', kind: 'info' })
        else flashUntilSyncDone({ msg: `Started sync #${r.syncId} for "${s.fetch_show_pattern}".` })
        await fetchSyncStatus()
        ensureSyncPolling()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        syncingId.value = null
      }
    }

    return {
      shows, fetchShows, folders, mediaRoot,
      newPattern, newFolder, newTemplate, newDeleteAfter, newAdRemoval,
      suggestion, suggestionIsNew, adding, loadingShows, syncingId, adRemovalEnabled,
      add, toggle, toggleDeleteAfter, setAdRemoval, remove, loadFetchShows, syncOne,
      flashText, flashKind,
    }
  },
}

const SyncsView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title" title="Older syncs auto-pruned to keep the latest 500.">SYNCS · {{ filter === 'all' ? 'LATEST' : filter.toUpperCase() }} {{ syncs.length }}</span>
          <div class="flex items-center gap-3">
            <span v-if="syncStatus.cron" class="text-xs font-mono text-ink-dim">CRON · <code>{{ syncStatus.cron }}</code></span>
            <span class="text-xs font-mono text-ink-mute" title="History is auto-capped server-side at 500 most recent syncs.">CAP · 500</span>
            <span v-if="flashText" :class="['status-readout', flashKind]">{{ flashText }}</span>
          </div>
        </header>
        <div class="panel-body space-y-4">
          <div class="flex flex-wrap gap-3">
            <button type="button" class="btn btn-primary" @click="syncNow" :disabled="starting || !!syncStatus.activeSyncId">
              {{ syncStatus.activeSyncId ? '● SYNC RUNNING…' : (starting ? 'STARTING…' : '▶ SYNC NOW') }}
            </button>
            <button type="button" class="btn" @click="manualRefresh">↻ REFRESH</button>
            <button type="button" class="btn btn-danger" @click="clearAll" :disabled="!syncs.length">⨯ CLEAR HISTORY</button>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim">ACTIVITY</span>
            <button v-for="opt in filterOptions" :key="opt.key"
              type="button"
              :class="['btn', 'btn-sm', filter === opt.key ? 'btn-primary' : '']"
              @click="setFilter(opt.key)">{{ opt.label }}</button>
          </div>

          <table v-if="syncs.length" class="deck-table">
            <thead><tr>
              <th>Started</th><th>Finished</th><th>Status</th><th>Summary</th><th></th>
            </tr></thead>
            <tbody>
              <tr v-for="s in syncs" :key="s.id" :class="{ active: s.id === syncStatus.activeSyncId }">
                <td class="font-mono">{{ fmtTime(s.started_at) }}</td>
                <td class="font-mono">{{ fmtTime(s.finished_at) }}</td>
                <td><span :class="['pill', s.status]">{{ s.status }}</span></td>
                <td><summary-line :summary="s.summary"/></td>
                <td>
                  <button type="button" class="btn btn-sm btn-icon btn-danger"
                    :disabled="s.id === syncStatus.activeSyncId"
                    @click="removeSync(s)"
                    title="Delete this sync from history.">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 5h10M6.5 5V3h3v2M4.5 5l.7 8.5h5.6L11.5 5M6.5 7.5v4M9.5 7.5v4"/>
                    </svg>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-ink-dim text-sm">
            {{ filter === 'all' ? 'No syncs yet.' : 'No syncs match the current filter.' }}
          </p>
        </div>
      </section>
    </div>
  `,
  setup() {
    const { flashText, flashKind, flash, flashUntilSyncDone } = useFlash()
    const syncs = ref([])
    const starting = ref(false)
    const filter = ref('all')
    const filterOptions = [
      { key: 'all',       label: 'ALL' },
      { key: 'manual',    label: 'MANUAL' },
      { key: 'cron',      label: 'CRON' },
      { key: 'downloads', label: 'DOWNLOADS' },
      { key: 'fails',     label: 'FAILS' },
      { key: 'deletes',   label: 'DELETES' },
      { key: 'empty',     label: 'EMPTY' },
    ]

    const refresh = async () => {
      const qs = filter.value === 'all' ? '' : `?filter=${filter.value}`
      const r = await api('GET', `/api/syncs${qs}`)
      syncs.value = r.syncs
    }

    const manualRefresh = async () => {
      try {
        await refresh()
        const label = filter.value === 'all' ? 'syncs' : `${filter.value} syncs`
        flash({ msg: `Refreshed — ${syncs.value.length} ${label}.` })
      } catch (err) {
        flash({ msg: `Refresh failed: ${err.message}`, kind: 'err', ms: 6000 })
      }
    }

    const setFilter = (v) => {
      filter.value = v
      refresh()
    }

    const syncNow = async () => {
      starting.value = true
      try {
        const r = await api('POST', '/api/sync')
        if (r.alreadyRunning) flash({ msg: 'A sync is already running.', kind: 'info' })
        else flashUntilSyncDone({ msg: `Started sync #${r.syncId}.` })
        await fetchSyncStatus()
        ensureSyncPolling()
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        starting.value = false
      }
    }

    const removeSync = async (s) => {
      if (!confirm(`Delete sync #${s.id}?`)) return
      try {
        await api('DELETE', `/api/syncs/${s.id}`)
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    const clearAll = async () => {
      const suffix = syncStatus.value.activeSyncId ? ' (except the active sync)' : ''
      if (!confirm(`Delete all sync history${suffix}?`)) return
      try {
        const r = await api('DELETE', '/api/syncs')
        flash({ msg: `Deleted ${r.deleted} sync${r.deleted === 1 ? '' : 's'}.` })
        await refresh()
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      }
    }

    let pollTimer = null
    onMounted(() => {
      refresh()
      pollTimer = setInterval(refresh, SYNCS_POLL_MS)
    })
    onUnmounted(() => {
      if (pollTimer) clearInterval(pollTimer)
    })
    const stopWatch = watch(() => syncStatus.value.activeSyncId, refresh)
    onUnmounted(stopWatch)

    return {
      syncs, syncStatus, starting,
      filter, filterOptions, setFilter,
      syncNow, refresh, manualRefresh, removeSync, clearAll,
      fmtTime,
      flashText, flashKind,
    }
  },
}

const RecordingsView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">RECORDINGS · {{ rangeLabel }} of {{ total }}</span>
          <div class="flex items-center gap-3">
            <span v-if="flashText" :class="['status-readout', flashKind]">{{ flashText }}</span>
            <button type="button" class="btn btn-sm btn-danger" @click="purgeDeleted"
              :disabled="purging"
              title="Remove all tombstoned rows from Fetcharr's history (recordings already deleted from the Fetch TV box).">
              {{ purging ? 'PURGING…' : '⨯ PURGE DELETED' }}
            </button>
            <button type="button" class="btn btn-sm" @click="manualRefresh">↻ REFRESH</button>
          </div>
        </header>
        <div class="panel-body space-y-4">
          <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim">STATUS</span>
              <button v-for="opt in statusOptions" :key="opt"
                type="button"
                :class="['btn', 'btn-sm', statusFilter === opt ? 'btn-primary' : '']"
                @click="setStatus(opt)">{{ opt.toUpperCase() }}</button>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim">SHOW</span>
              <select :value="showFilter" @change="setShow($event.target.value)"
                class="field-input" style="width: auto; min-width: 9rem; padding-top: 0.3rem; padding-bottom: 0.3rem;">
                <option value="all">— any —</option>
                <option v-for="s in shows" :key="s.id" :value="s.id">{{ s.fetch_show_pattern }}</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim">WHEN</span>
              <button v-for="opt in sinceOptions" :key="opt.key"
                type="button"
                :class="['btn', 'btn-sm', sinceFilter === opt.key ? 'btn-primary' : '']"
                @click="setSince(opt.key)">{{ opt.label }}</button>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono uppercase tracking-[0.16em] text-ink-dim">ON FETCH</span>
              <button v-for="opt in deletedOptions" :key="opt.key"
                type="button"
                :class="['btn', 'btn-sm', deletedFilter === opt.key ? 'btn-primary' : '']"
                @click="setDeleted(opt.key)">{{ opt.label }}</button>
            </div>
          </div>
          <p class="text-xs font-mono text-ink-mute">
            Legend: <span class="tombstone-legend">struck-through + dim</span> = deleted from the Fetch TV box.
          </p>
          <table v-if="recordings.length" class="deck-table">
            <thead><tr>
              <th class="sortable" @click="toggleSort('show_pattern')">Show{{ sortMarker('show_pattern') }}</th>
              <th class="sortable" @click="toggleSort('fetch_title')">Title{{ sortMarker('fetch_title') }}</th>
              <th>S/E</th>
              <th class="sortable" @click="toggleSort('size')">Size{{ sortMarker('size') }}</th>
              <th class="sortable" @click="toggleSort('status')">Status{{ sortMarker('status') }}</th>
              <th title="Ad break detection/removal status. Hover a pill for break count + minutes.">Ads</th>
              <th class="sortable" @click="toggleSort('downloaded_at')">Downloaded{{ sortMarker('downloaded_at') }}</th>
              <th></th>
            </tr></thead>
            <tbody>
              <tr v-for="r in recordings" :key="r.fetch_id"
                :class="{ tombstone: r.deleted_from_fetch_at }"
                :title="r.deleted_from_fetch_at ? 'Deleted from Fetch ' + fmtTime(r.deleted_from_fetch_at) : ''">
                <td class="font-mono">{{ r.show_pattern || '—' }}</td>
                <td class="font-mono">{{ r.fetch_title }}</td>
                <td class="font-mono">{{ se(r) }}</td>
                <td class="font-mono whitespace-nowrap">{{ fmtBytes(r.size) }}</td>
                <td>
                  <span v-if="isRecording(r)" class="pill recording">RECORDING</span>
                  <template v-else>
                    <span :class="['pill', r.status]">{{ r.status }}</span>
                    <span v-if="r.error" class="block text-xs font-mono text-signal-magenta-hi mt-1">{{ r.error }}</span>
                  </template>
                  <div v-if="progressPhase(r) === 'downloading'" class="progress">
                    <div class="progress-track">
                      <div class="progress-fill" :style="{ width: (r.progress.percent || 0) + '%' }"></div>
                    </div>
                    <span class="progress-caption">{{ progressCaption(r) }}</span>
                  </div>
                </td>
                <td>
                  <span v-if="r.ad_status" :class="['pill', r.ad_status]" :title="adTooltip(r)">{{ adLabel(r.ad_status) }}</span>
                  <span v-else-if="!progressPhase(r)" class="text-ink-mute">—</span>
                  <div v-if="isAdProgress(r)" class="progress">
                    <div v-if="hasBar(r)" class="progress-track">
                      <div class="progress-fill" :class="{ indeterminate: r.progress.percent == null }"
                        :style="r.progress.percent == null ? {} : { width: r.progress.percent + '%' }"></div>
                    </div>
                    <span class="progress-caption">{{ progressCaption(r) }}</span>
                  </div>
                </td>
                <td class="font-mono whitespace-nowrap">{{ fmtTime(r.downloaded_at) }}</td>
                <td>
                  <div class="flex items-center gap-2">
                  <button v-if="canAdScan(r)" type="button" class="btn btn-sm btn-icon"
                    @click="adScan(r)" :disabled="adScanningId === r.fetch_id"
                    title="Scan this recording for ad breaks now (uses the show's ad removal mode; detect-only when the show is off).">
                    <span v-if="adScanningId === r.fetch_id">…</span>
                    <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="4" cy="4.5" r="1.75"/>
                      <circle cx="4" cy="11.5" r="1.75"/>
                      <path d="M5.5 5.75 13 12M5.5 10.25 13 4"/>
                    </svg>
                  </button>
                  <button v-if="canDelete(r)" type="button" class="btn btn-sm btn-icon btn-danger"
                    @click="deleteFromFetch(r)" :disabled="deletingId === r.fetch_id"
                    title="Delete this recording from the Fetch TV box. Irreversible.">
                    <span v-if="deletingId === r.fetch_id">…</span>
                    <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 5h10M6.5 5V3h3v2M4.5 5l.7 8.5h5.6L11.5 5M6.5 7.5v4M9.5 7.5v4"/>
                    </svg>
                  </button>
                  <button v-else-if="r.deleted_from_fetch_at" type="button" class="btn btn-sm btn-icon btn-danger"
                    @click="removeRecording(r)" :disabled="removingId === r.fetch_id"
                    title="Remove this tombstone from Fetcharr's history.">
                    <span v-if="removingId === r.fetch_id">…</span>
                    <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 5h10M6.5 5V3h3v2M4.5 5l.7 8.5h5.6L11.5 5M6.5 7.5v4M9.5 7.5v4"/>
                    </svg>
                  </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else-if="total === 0" class="text-ink-dim text-sm">
            {{ hasFiltersApplied ? 'No recordings match the current filters.' : 'No recordings tracked yet.' }}
          </p>
          <div v-if="total > pageSize" class="flex items-center justify-between gap-3 font-mono text-xs text-ink-dim pt-1">
            <span>Page {{ page }} of {{ totalPages }} · {{ total }} total</span>
            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-sm" :disabled="page <= 1" @click="page = page - 1">← PREV</button>
              <button type="button" class="btn btn-sm" :disabled="page >= totalPages" @click="page = page + 1">NEXT →</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `,
  setup() {
    const { flashText, flashKind, flash } = useFlash()
    const recordings = ref([])
    const shows = ref([])
    const deletingId = ref(null)
    const removingId = ref(null)
    const purging = ref(false)
    const adRemovalEnabled = ref(false)
    const adScanningId = ref(null)
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(50)
    const sortCol = ref(null)
    const sortDir = ref(null)
    const statusFilter = ref('all')
    const showFilter = ref('all')
    const sinceFilter = ref('all')
    const deletedFilter = ref('all')

    const statusOptions = ['all', 'recording', 'done', 'partial', 'failed', 'skipped', 'downloading']
    const sinceOptions = [
      { key: 'all', label: 'ALL' },
      { key: '1h',  label: '1H'  },
      { key: '24h', label: '24H' },
      { key: '7d',  label: '7D'  },
      { key: '30d', label: '30D' },
      { key: '90d', label: '90D' },
    ]
    const deletedOptions = [
      { key: 'all',      label: 'ALL'      },
      { key: 'on_fetch', label: 'ON FETCH' },
      { key: 'deleted',  label: 'DELETED'  },
    ]

    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

    const rangeLabel = computed(() => {
      if (total.value === 0) return '0'
      const start = (page.value - 1) * pageSize.value + 1
      const end = Math.min(total.value, page.value * pageSize.value)
      return `${start}–${end}`
    })

    const hasFiltersApplied = computed(() =>
      statusFilter.value !== 'all'
      || showFilter.value !== 'all'
      || sinceFilter.value !== 'all'
      || deletedFilter.value !== 'all',
    )

    const manualRefresh = async () => {
      try {
        await refresh()
        flash({ msg: `Refreshed — ${total.value} recording${total.value === 1 ? '' : 's'}.` })
      } catch (err) {
        flash({ msg: `Refresh failed: ${err.message}`, kind: 'err', ms: 6000 })
      }
    }

    const refresh = async () => {
      const params = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize.value),
      })
      if (sortCol.value) params.set('sort', sortCol.value)
      if (sortDir.value) params.set('dir', sortDir.value)
      if (statusFilter.value !== 'all') params.set('status', statusFilter.value)
      if (showFilter.value !== 'all') params.set('show_id', String(showFilter.value))
      if (sinceFilter.value !== 'all') params.set('since', sinceFilter.value)
      if (deletedFilter.value !== 'all') params.set('deleted', deletedFilter.value)
      const r = await api('GET', `/api/recordings?${params}`)
      recordings.value = r.recordings
      total.value = r.total
      if (page.value > 1 && r.recordings.length === 0) page.value = 1
    }

    const loadShows = async () => {
      const r = await api('GET', '/api/shows').catch(() => ({ shows: [] }))
      shows.value = r.shows || []
    }

    const loadAdRemovalSetting = async () => {
      const s = await api('GET', '/api/settings').catch(() => ({}))
      adRemovalEnabled.value = Boolean(s.ad_removal_enabled)
    }

    const setStatus = (v) => { statusFilter.value = v; page.value = 1 }
    const setShow = (v) => { showFilter.value = v; page.value = 1 }
    const setSince = (v) => { sinceFilter.value = v; page.value = 1 }
    const setDeleted = (v) => { deletedFilter.value = v; page.value = 1 }

    const toggleSort = (col) => {
      if (sortCol.value !== col) {
        sortCol.value = col
        sortDir.value = 'desc'
      } else if (sortDir.value === 'desc') {
        sortDir.value = 'asc'
      } else {
        sortCol.value = null
        sortDir.value = null
      }
      page.value = 1
    }

    const sortMarker = (col) => {
      if (sortCol.value !== col || !sortDir.value) return ''
      return sortDir.value === 'desc' ? ' ↓' : ' ↑'
    }

    const canDelete = (r) => r.status === 'done' && !r.deleted_from_fetch_at
    const isRecording = (r) => r.status === 'skipped' && r.error === 'currently recording'
    const canAdScan = (r) => adRemovalEnabled.value && r.status === 'done'

    const adLabel = (status) => status.replace(/_/g, ' ')

    const progressPhase = (r) => r.progress?.phase || null

    const isAdProgress = (r) => {
      const phase = progressPhase(r)
      return phase === 'scanning' || phase === 'cutting' || phase === 'verifying'
    }

    const hasBar = (r) => {
      const phase = progressPhase(r)
      return phase === 'downloading' || phase === 'scanning'
    }

    const progressCaption = (r) => {
      const p = r.progress
      if (!p) return ''
      if (p.phase === 'downloading') {
        const bits = [`${p.percent}%`]
        if (p.etaLabel) bits.push(p.etaLabel)
        if (p.detail) bits.push(p.detail)
        return bits.join(' · ')
      }
      if (p.phase === 'scanning') {
        if (p.percent == null) return p.detail || 'scanning'
        return p.etaLabel ? `${p.percent}% · ~${p.etaLabel} left` : `${p.percent}%`
      }
      return p.detail || p.phase
    }

    const adTooltip = (r) => {
      if (!r.ad_breaks_json) return ''
      try {
        const breaks = JSON.parse(r.ad_breaks_json)
        const secs = breaks.reduce((sum, b) => sum + (b.end - b.start), 0)
        return `${breaks.length} break${breaks.length === 1 ? '' : 's'} · ${(secs / 60).toFixed(1)} min of ads`
      } catch {
        return ''
      }
    }

    const adScan = async (r) => {
      adScanningId.value = r.fetch_id
      try {
        await api('POST', `/api/recordings/${encodeURIComponent(r.fetch_id)}/ad-scan`)
        flash({ msg: `Ad scan started for "${r.fetch_title}" — can take minutes.` })
        await refresh()
      } catch (err) {
        flash({ msg: `Ad scan failed: ${err.message}`, kind: 'err', ms: 6000 })
      } finally {
        adScanningId.value = null
      }
    }

    const deleteFromFetch = async (r) => {
      const prompt = `Delete "${r.fetch_title}" from the Fetch TV box?\n\n`
        + 'This is irreversible — the recording on the box will be gone.'
      if (!confirm(prompt)) return
      deletingId.value = r.fetch_id
      try {
        const url = `/api/recordings/${encodeURIComponent(r.fetch_id)}/delete-from-fetch`
        const result = await api('POST', url)
        if (result.ok) {
          flash({ msg: `Deleted "${r.fetch_title}" from Fetch.` })
          await refresh()
        } else {
          flash({
            msg: `Delete failed: ${result.error} (stage: ${result.stage || '?'})`,
            kind: 'err',
            ms: 8000,
          })
        }
      } catch (err) {
        flash({ msg: `Delete failed: ${err.message}`, kind: 'err', ms: 8000 })
      } finally {
        deletingId.value = null
      }
    }

    const removeRecording = async (r) => {
      if (!confirm(`Remove "${r.fetch_title}" from Fetcharr's history?`)) return
      removingId.value = r.fetch_id
      try {
        await api('DELETE', `/api/recordings/${encodeURIComponent(r.fetch_id)}`)
        flash({ msg: `Removed "${r.fetch_title}".` })
        await refresh()
      } catch (err) {
        flash({ msg: `Remove failed: ${err.message}`, kind: 'err', ms: 6000 })
      } finally {
        removingId.value = null
      }
    }

    const purgeDeleted = async () => {
      if (!confirm('Purge all tombstoned recordings from Fetcharr\'s history?')) return
      purging.value = true
      try {
        const r = await api('DELETE', '/api/recordings?deleted=true')
        flash({ msg: `Purged ${r.deleted} tombstone${r.deleted === 1 ? '' : 's'}.` })
        await refresh()
      } catch (err) {
        flash({ msg: `Purge failed: ${err.message}`, kind: 'err', ms: 6000 })
      } finally {
        purging.value = false
      }
    }

    let pollTimer = null
    const hasActiveProgress = () => recordings.value.some((r) => r.progress)
    const scheduleNextPoll = () => {
      const delay = hasActiveProgress() ? RECORDINGS_ACTIVE_POLL_MS : RECORDINGS_POLL_MS
      pollTimer = setTimeout(pollTick, delay)
    }
    const pollTick = async () => {
      await refresh().catch(() => {})
      scheduleNextPoll()
    }
    onMounted(() => {
      loadShows()
      loadAdRemovalSetting()
      refresh().catch(() => {}).finally(scheduleNextPoll)
    })
    onUnmounted(() => {
      if (pollTimer) clearTimeout(pollTimer)
    })

    watch(
      [page, sortCol, sortDir, statusFilter, showFilter, sinceFilter, deletedFilter],
      refresh,
    )

    const stopSyncWatch = watch(() => syncStatus.value.activeSyncId, refresh)
    onUnmounted(stopSyncWatch)

    return {
      recordings, shows, total, page, pageSize, totalPages, rangeLabel,
      sortCol, sortDir, statusFilter, showFilter, sinceFilter, deletedFilter,
      statusOptions, sinceOptions, deletedOptions, hasFiltersApplied,
      deletingId, removingId, purging, adRemovalEnabled, adScanningId,
      refresh, manualRefresh, canDelete, isRecording,
      canAdScan, adLabel, adTooltip, adScan,
      progressPhase, isAdProgress, hasBar, progressCaption,
      deleteFromFetch, removeRecording, purgeDeleted,
      setStatus, setShow, setSince, setDeleted, toggleSort, sortMarker,
      se: seasonEpisodeLabel, fmtBytes, fmtTime,
      flashText, flashKind,
    }
  },
}

const SettingsView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">SETUP WIZARD</span>
          <span class="text-xs font-mono text-ink-dim">re-walk the first-run flow</span>
        </header>
        <div class="panel-body flex flex-wrap items-center justify-between gap-4">
          <p class="text-sm text-ink-dim leading-relaxed max-w-2xl">
            Re-open the guided setup at any time. Already-saved values prefill — including a <code>••••• (stored)</code> hint for the Plex token and Fetch Cloud PIN — so you can tweak one step without retyping the rest. To wipe captured data first, use <strong class="text-ink">NUKE ALL STATE</strong> in the Danger Zone below.
          </p>
          <button type="button" class="btn" @click="reopenWizard">↻ REOPEN WIZARD</button>
        </div>
      </section>
      <form @submit.prevent="save" class="space-y-6 pb-20">
        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">FETCH TV BOX</span>
            <span class="text-xs font-mono text-ink-dim">UPnP / SSDP · LAN</span>
          </header>
          <div class="panel-body grid gap-4 md:grid-cols-2">
            <div class="field-row">
              <label class="field-label">Fetch TV IP</label>
              <input type="text" class="field-input" v-model="fetchIp" placeholder="e.g. 192.168.86.33" />
            </div>
            <div class="field-row">
              <label class="field-label">Fetch TV port</label>
              <input type="number" class="field-input" v-model="fetchPort" placeholder="49152" />
            </div>
            <div class="field-row md:col-span-2">
              <label class="field-label">Sync cron (5-field, e.g. <code>*/30 * * * *</code>)</label>
              <input type="text" class="field-input" v-model="syncCron" :placeholder="syncCronEffective || '*/30 * * * *'" />
              <p v-if="!syncCron && syncCronEffective" class="text-xs text-ink-dim mt-2">
                Currently running on <code>{{ syncCronEffective }}</code> (scheduler default).
              </p>
            </div>
            <div class="md:col-span-2 flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="discover" :disabled="discovering">
                {{ discovering ? 'SCANNING…' : '◎ AUTO-DISCOVER' }}
              </button>
              <span v-if="status" :class="['status-readout', statusKind]">{{ status }}</span>
            </div>
            <div v-if="candidates.length > 1" class="md:col-span-2">
              <p class="text-sm text-ink-dim mb-2">Multiple Fetch TV boxes found — pick one:</p>
              <ul class="space-y-2">
                <li v-for="c in candidates" :key="c.ip">
                  <button type="button" class="btn" @click="useCandidate(c)">
                    Use {{ c.friendlyName || c.modelName || 'Fetch TV' }} ({{ c.ip }}:{{ c.port }})
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">STORAGE</span>
            <span class="text-xs font-mono text-ink-dim">where recordings land</span>
          </header>
          <div class="panel-body space-y-4">
            <div class="field-row">
              <label class="field-label">Media root <span class="text-ink-mute">(inside container)</span></label>
              <input type="text" class="field-input" v-model="mediaRoot" placeholder="/media/tv" />
              <p class="text-xs text-ink-mute mt-1 leading-relaxed">
                Container-internal directory where Fetcharr writes downloads. In Docker, this must match a bind-mount target in your <code>docker-compose.yml</code> — changing it without updating compose will silently fail. Bare-metal: an absolute path you own and can write to.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn-sm" @click="testMediaRoot" :disabled="mediaRootTesting">
                {{ mediaRootTesting ? 'TESTING…' : '↯ TEST PATH' }}
              </button>
              <span v-if="mediaRootStatus" :class="['status-readout', mediaRootStatusKind]">{{ mediaRootStatus }}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">FETCH CLOUD ACCOUNT</span>
            <span class="text-xs font-mono text-ink-dim">required for delete-from-Fetch</span>
          </header>
          <div class="panel-body space-y-4">
            <p class="text-sm text-ink-dim leading-relaxed">
              Fetch firmware blocks LAN deletion. To delete recordings after they sync, Fetcharr signs into Fetch's cloud over the same WebSocket the Fetch mobile app uses. Sign in at
              <a href="https://www.fetchtv.com.au/manage/account/summary" target="_blank" rel="noopener noreferrer">fetchtv.com.au/manage/account/summary</a>
              — under <em>Your Service → Boxes</em> each box is listed as <em>STB 1</em>, <em>STB 2</em>, etc., and the value next to it (e.g. <code>nqp…</code>) is the activation code. The PIN is the account PIN you set when you first activated Fetch.
            </p>
            <div class="grid gap-4 md:grid-cols-3">
              <div class="field-row">
                <label class="field-label">Activation code</label>
                <input type="text" class="field-input" v-model="fetchCloudActivationCode" placeholder="e.g. 12-digit number" autocomplete="off" />
              </div>
              <div class="field-row">
                <label class="field-label">PIN</label>
                <input type="password" class="field-input" v-model="fetchCloudPin" :placeholder="fetchCloudPinSet ? '••••• (stored)' : '4-digit PIN'" autocomplete="off" />
              </div>
              <div class="field-row">
                <label class="field-label">Terminal ID</label>
                <select v-if="fetchCloudTerminals.length" class="field-input" v-model="fetchCloudTerminalId">
                  <option value="">— pick a box —</option>
                  <option v-for="t in fetchCloudTerminals" :key="t.id" :value="t.id" :disabled="!t.hasPvr">
                    {{ t.friendlyName || t.deviceType || 'Box' }} ({{ t.id }}){{ t.hasPvr ? '' : ' — no PVR' }}
                  </option>
                </select>
                <input v-else type="text" class="field-input" v-model="fetchCloudTerminalId"
                  placeholder="auto-detected after Test" autocomplete="off" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="testFetchCloud" :disabled="fetchCloudTesting">
                {{ fetchCloudTesting ? 'TESTING…' : '↯ TEST CONNECTION' }}
              </button>
              <span v-if="fetchCloudStatus" :class="['status-readout', fetchCloudStatusKind]">{{ fetchCloudStatus }}</span>
            </div>
            <div class="flex items-center gap-3 pt-2">
              <input id="del-plex-only" type="checkbox" class="chk" v-model="deleteAfterPlexRefreshOnly" />
              <label for="del-plex-only" class="text-sm text-ink-dim">
                Only delete from Fetch after Plex refresh succeeds
                <span class="text-ink-mute">(recommended — confirms file is in Plex first)</span>
              </label>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">PLEX</span>
            <span class="text-xs font-mono text-ink-dim">post-sync section refresh</span>
          </header>
          <div class="panel-body grid gap-4 md:grid-cols-2">
            <div class="md:col-span-2 flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="discoverPlex" :disabled="plexDiscovering">
                {{ plexDiscovering ? 'SCANNING…' : '◎ AUTO-DISCOVER PLEX' }}
              </button>
              <span class="text-xs font-mono text-ink-dim">GDM · LAN broadcast</span>
            </div>
            <div v-if="plexCandidates.length > 1" class="md:col-span-2">
              <p class="text-sm text-ink-dim mb-2">Multiple Plex servers found — pick one:</p>
              <ul class="space-y-2">
                <li v-for="c in plexCandidates" :key="c.ip + ':' + c.port">
                  <button type="button" class="btn" @click="usePlexCandidate(c)">
                    Use {{ c.name || 'Plex' }} ({{ c.ip }}:{{ c.port }})
                  </button>
                </li>
              </ul>
            </div>
            <div class="field-row md:col-span-2">
              <label class="field-label">Plex URL</label>
              <input type="text" class="field-input" v-model="plexUrl" placeholder="http://127.0.0.1:32400" />
            </div>
            <div class="field-row md:col-span-2">
              <label class="field-label">Plex token</label>
              <input type="password" class="field-input" v-model="plexToken"
                :placeholder="plexTokenSet ? '••••• (stored)' : 'X-Plex-Token'" autocomplete="off" />
              <div class="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" class="btn btn-sm" @click="detectPlexToken" :disabled="plexDetecting">
                  {{ plexDetecting ? 'DETECTING…' : '⚡ AUTO-DETECT TOKEN' }}
                </button>
                <span v-if="plexTokenStatus" :class="['status-readout', plexTokenStatusKind]">{{ plexTokenStatus }}</span>
              </div>
              <p class="text-xs text-ink-mute mt-1 leading-relaxed">
                Reads <code>PlexOnlineToken</code> from <code>Preferences.xml</code> at the path below. Requires Plex to run on the same host as Fetcharr with its config dir bind-mounted into the container. URL doesn't have to be localhost — works even if Plex was discovered as a LAN IP.
              </p>
            </div>
            <div class="field-row md:col-span-2">
              <label class="field-label">Preferences.xml path <span class="text-ink-mute">(inside container)</span></label>
              <input type="text" class="field-input" v-model="plexPrefsPath" placeholder="/plex-preferences.xml" />
              <p class="text-xs text-ink-mute mt-1 leading-relaxed">
                Container-internal path. Requires a Docker bind-mount targeting this path. Edit if you mount Plex's config at a non-default location.
              </p>
            </div>
            <div class="field-row md:col-span-2">
              <label class="field-label">Plex TV section</label>
              <select v-if="plexSections.length" class="field-input" v-model="plexSectionId">
                <option value="">— pick a section —</option>
                <option v-for="sec in plexSections" :key="sec.key" :value="sec.key">
                  {{ sec.title }} (#{{ sec.key }}, {{ sec.type }})
                </option>
              </select>
              <input v-else type="text" class="field-input" v-model="plexSectionId"
                placeholder="numeric section ID (use Load sections to discover)" />
            </div>
            <div class="md:col-span-2 flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="loadPlexSections" :disabled="plexProbing">
                {{ plexProbing ? 'PROBING…' : '⇣ LOAD SECTIONS' }}
              </button>
              <button type="button" class="btn" @click="refreshPlexNow" :disabled="plexRefreshing">
                {{ plexRefreshing ? 'REFRESHING…' : '↻ REFRESH PLEX NOW' }}
              </button>
              <span v-if="plexStatus" :class="['status-readout', plexStatusKind]">{{ plexStatus }}</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">AD REMOVAL</span>
            <span class="text-xs font-mono text-ink-dim">comskip · optional</span>
          </header>
          <div class="panel-body space-y-4">
            <div class="flex items-center gap-3">
              <input id="ad-removal-enabled" type="checkbox" class="chk" v-model="adRemovalEnabled" />
              <label for="ad-removal-enabled" class="text-sm text-ink-dim">
                Enable ad removal
                <span class="text-ink-mute">(per-show mode is set on the Shows tab)</span>
              </label>
            </div>
            <div class="field-row md:max-w-xs">
              <label class="field-label">Keep <code>.orig</code> backups for (days)</label>
              <input type="number" min="1" class="field-input" v-model="adOriginalRetentionDays" />
            </div>
            <p class="text-xs font-mono text-ink-dim">
              comskip.ini: <code>{{ comskipIniOverride ? '/config/comskip.ini (override)' : 'bundled AU free-to-air default' }}</code>
            </p>
            <p class="text-xs text-ink-mute leading-relaxed">
              Detection runs comskip on each downloaded recording and is CPU-heavy — expect minutes per episode. CUT mode rewrites the file (keyframe stream-copy, no transcode) and keeps the original as <code>&lt;file&gt;.ts.orig</code> until the retention window lapses. Detection accuracy varies by channel; trial DETECT mode before trusting CUT.
            </p>
          </div>
        </section>

        <section class="panel">
          <header class="panel-header">
            <span class="panel-title">DANGER ZONE</span>
            <span class="text-xs font-mono text-ink-dim">irreversible</span>
          </header>
          <div class="panel-body space-y-4">
            <div>
              <p class="text-sm text-ink leading-relaxed">
                Wipe all settings, shows, recordings history, and sync history from Fetcharr's database. The next time you open Fetcharr, the setup wizard fires from scratch.
              </p>
              <p class="text-xs text-ink-mute leading-relaxed mt-2">
                Your downloaded video files in <code>{{ mediaRoot || '/media/tv' }}</code> are <strong>not touched</strong> — only Fetcharr's own bookkeeping is cleared. Refused while a sync is running.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn btn-danger" @click="nukeState" :disabled="nuking">
                {{ nuking ? 'NUKING…' : '☠ NUKE ALL STATE' }}
              </button>
            </div>
          </div>
        </section>

        <div class="settings-save-bar">
          <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
            <span v-if="status" :class="['status-readout', statusKind]">{{ status }}</span>
            <span v-else class="text-xs font-mono text-ink-mute">Changes apply on save · scheduler reloads if <code>sync_cron</code> changed.</span>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? 'SAVING…' : '✓ SAVE SETTINGS' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  `,
  setup() {
    const fetchIp = ref('')
    const fetchPort = ref('')
    const syncCron = ref('')
    const syncCronEffective = ref('')
    const plexUrl = ref('')
    const plexToken = ref('')
    const plexTokenSet = ref(false)
    const plexSectionId = ref('')
    const plexSections = ref([])
    const plexProbing = ref(false)
    const plexRefreshing = ref(false)
    const plexDetecting = ref(false)
    const plexTokenStatus = ref('')
    const plexTokenStatusKind = ref('ok')
    const plexDiscovering = ref(false)
    const plexCandidates = ref([])
    const plexPrefsPath = ref('')
    const fetchCloudActivationCode = ref('')
    const fetchCloudPin = ref('')
    const fetchCloudPinSet = ref(false)
    const fetchCloudTerminalId = ref('')
    const fetchCloudTerminals = ref([])
    const fetchCloudTesting = ref(false)
    const fetchCloudStatus = ref('')
    const fetchCloudStatusKind = ref('ok')
    const deleteAfterPlexRefreshOnly = ref(true)
    const adRemovalEnabled = ref(false)
    const adOriginalRetentionDays = ref('7')
    const comskipIniOverride = ref(false)
    const status = ref('')
    const statusKind = ref('ok')
    const plexStatus = ref('')
    const plexStatusKind = ref('ok')
    const saving = ref(false)
    const discovering = ref(false)
    const candidates = ref([])
    const nuking = ref(false)
    const mediaRoot = ref('')
    const mediaRootTesting = ref(false)
    const mediaRootStatus = ref('')
    const mediaRootStatusKind = ref('ok')

    const flash = ({ msg, kind = 'ok', ms = FLASH_DEFAULT_MS }) => {
      status.value = msg
      statusKind.value = kind
      if (ms > 0) setTimeout(() => (status.value = ''), ms)
    }

    const setPlexStatus = (msg, kind = 'ok', ms = FLASH_DEFAULT_MS) => {
      plexStatus.value = msg
      plexStatusKind.value = kind
      if (ms > 0) setTimeout(() => (plexStatus.value = ''), ms)
    }

    const setPlexTokenStatus = (msg, kind = 'ok', ms = FLASH_DEFAULT_MS) => {
      plexTokenStatus.value = msg
      plexTokenStatusKind.value = kind
      if (ms > 0) setTimeout(() => (plexTokenStatus.value = ''), ms)
    }

    onMounted(async () => {
      const s = await api('GET', '/api/settings')
      fetchIp.value = s.fetch_ip || ''
      fetchPort.value = s.fetch_port || ''
      syncCron.value = s.sync_cron || ''
      syncCronEffective.value = s.sync_cron_effective || ''
      if (s.tz) tz.value = s.tz
      plexUrl.value = s.plex_url || ''
      plexTokenSet.value = Boolean(s.plex_token_set)
      plexSectionId.value = s.plex_tv_section_id || ''
      plexPrefsPath.value = s.plex_prefs_path || ''
      mediaRoot.value = s.media_root || ''
      fetchCloudActivationCode.value = s.fetch_cloud_activation_code || ''
      fetchCloudPinSet.value = Boolean(s.fetch_cloud_pin_set)
      fetchCloudTerminalId.value = s.fetch_cloud_terminal_id || ''
      deleteAfterPlexRefreshOnly.value = s.delete_after_plex_refresh_only !== false
      adRemovalEnabled.value = Boolean(s.ad_removal_enabled)
      adOriginalRetentionDays.value = s.ad_original_retention_days || '7'
      comskipIniOverride.value = Boolean(s.comskip_ini_override)
    })

    const save = async () => {
      saving.value = true
      try {
        const body = {
          fetch_ip: fetchIp.value,
          fetch_port: fetchPort.value,
          sync_cron: syncCron.value,
          plex_url: plexUrl.value,
          plex_tv_section_id: plexSectionId.value,
          plex_prefs_path: plexPrefsPath.value,
          media_root: mediaRoot.value,
          fetch_cloud_activation_code: fetchCloudActivationCode.value,
          fetch_cloud_terminal_id: fetchCloudTerminalId.value,
          delete_after_plex_refresh_only: deleteAfterPlexRefreshOnly.value,
          ad_removal_enabled: adRemovalEnabled.value,
          ad_original_retention_days: adOriginalRetentionDays.value,
        }
        if (plexToken.value) body.plex_token = plexToken.value
        if (fetchCloudPin.value) body.fetch_cloud_pin = fetchCloudPin.value
        await api('POST', '/api/settings', body)
        if (plexToken.value) {
          plexTokenSet.value = true
          plexToken.value = ''
        }
        if (fetchCloudPin.value) {
          fetchCloudPinSet.value = true
          fetchCloudPin.value = ''
        }
        flash({ msg: 'Saved.' })
      } catch (err) {
        flash({ msg: `Error: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        saving.value = false
      }
    }

    const testFetchCloud = async () => {
      fetchCloudTesting.value = true
      fetchCloudStatus.value = 'Authenticating + opening WebSocket…'
      fetchCloudStatusKind.value = 'info'
      try {
        const body = {}
        if (fetchCloudActivationCode.value) body.activation_code = fetchCloudActivationCode.value
        if (fetchCloudPin.value) body.pin = fetchCloudPin.value
        const r = await api('POST', '/api/fetch-cloud-test', body)
        fetchCloudTerminals.value = r.terminals || []
        if (r.terminal_id_detected && !fetchCloudTerminalId.value) {
          fetchCloudTerminalId.value = r.terminal_id_detected
        }
        if (fetchCloudPin.value) {
          fetchCloudPinSet.value = true
          fetchCloudPin.value = ''
        }
        const n = (r.terminals || []).length
        const where = n === 1 ? '1 box' : `${n} boxes`
        fetchCloudStatus.value = `Connected — found ${where} on this account.`
        fetchCloudStatusKind.value = 'ok'
      } catch (err) {
        fetchCloudStatus.value = `Failed: ${err.message}`
        fetchCloudStatusKind.value = 'err'
      } finally {
        fetchCloudTesting.value = false
      }
    }

    const loadPlexSections = async () => {
      plexProbing.value = true
      try {
        const body = { plex_url: plexUrl.value }
        if (plexToken.value) body.plex_token = plexToken.value
        const { sections = [] } = await api('POST', '/api/plex-sections', body)
        plexSections.value = sections
        if (sections.length === 0) {
          setPlexStatus('Connected to Plex, but no library sections returned.', 'info', 6000)
        } else {
          setPlexStatus(`Loaded ${sections.length} Plex sections.`)
        }
      } catch (err) {
        setPlexStatus(`Plex probe failed: ${err.message}`, 'err', 8000)
      } finally {
        plexProbing.value = false
      }
    }

    const detectPlexToken = async () => {
      plexDetecting.value = true
      try {
        if (plexPrefsPath.value) {
          await api('POST', '/api/settings', { plex_prefs_path: plexPrefsPath.value })
        }
        const r = await api('POST', '/api/plex-detect-token')
        if (r.ok) {
          plexTokenSet.value = true
          plexToken.value = r.token || ''
          setPlexTokenStatus(`Token detected from ${r.source}.`, 'ok', 5000)
        } else {
          setPlexTokenStatus(`Auto-detect failed: ${r.reason}`, 'err', 8000)
        }
      } catch (err) {
        setPlexTokenStatus(`Auto-detect failed: ${err.message}`, 'err', 8000)
      } finally {
        plexDetecting.value = false
      }
    }

    const discoverPlex = async () => {
      plexDiscovering.value = true
      plexCandidates.value = []
      flash({ msg: 'Broadcasting GDM (~2s)…', kind: 'info', ms: 0 })
      try {
        const { servers = [] } = await api('POST', '/api/discover-plex')
        if (servers.length === 0) {
          flash({ msg: 'No Plex servers found on the LAN.', kind: 'err', ms: 5000 })
        } else if (servers.length === 1) {
          usePlexCandidate(servers[0])
        } else {
          plexCandidates.value = servers
          flash({ msg: `Found ${servers.length} Plex servers — choose one below.`, kind: 'info', ms: 5000 })
        }
      } catch (err) {
        flash({ msg: `Plex discovery failed: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        plexDiscovering.value = false
      }
    }

    const usePlexCandidate = (c) => {
      plexUrl.value = `http://${c.ip}:${c.port}`
      plexCandidates.value = []
      flash({ msg: `Selected ${c.name || 'Plex'} at ${c.ip}:${c.port}. Save to persist.`, ms: 5000 })
    }

    const testMediaRoot = async () => {
      mediaRootTesting.value = true
      mediaRootStatus.value = ''
      try {
        const r = await api('POST', '/api/media-root-test', { path: mediaRoot.value })
        if (r.ok) {
          mediaRootStatus.value = `OK — ${r.path} is writable.`
          mediaRootStatusKind.value = 'ok'
        } else {
          mediaRootStatus.value = r.error
          mediaRootStatusKind.value = 'err'
        }
      } catch (err) {
        mediaRootStatus.value = `Test failed: ${err.message}`
        mediaRootStatusKind.value = 'err'
      } finally {
        mediaRootTesting.value = false
      }
    }

    const nukeState = async () => {
      const mediaPath = mediaRoot.value || '/media/tv'
      const prompt = 'NUKE ALL STATE?\n\n'
        + 'This deletes every setting, show, recording entry, and sync from Fetcharr\'s database.\n\n'
        + `Your downloaded video files in ${mediaPath} are NOT touched.\n\n`
        + 'This cannot be undone. Continue?'
      if (!confirm(prompt)) return
      nuking.value = true
      try {
        await api('POST', '/api/nuke-state')
        try { localStorage.removeItem(WELCOME_DISMISSED_KEY) } catch { /* private mode */ }
        window.location.hash = '#/welcome'
        window.location.reload()
      } catch (err) {
        flash({ msg: `Nuke failed: ${err.message}`, kind: 'err', ms: 6000 })
        nuking.value = false
      }
    }

    const reopenWizard = () => {
      try { localStorage.removeItem(WELCOME_DISMISSED_KEY) } catch { /* private mode */ }
      if (window.location.hash === '#/welcome') {
        window.location.reload()
      } else {
        window.location.hash = '#/welcome'
      }
    }

    const refreshPlexNow = async () => {
      plexRefreshing.value = true
      try {
        const body = {
          plex_url: plexUrl.value,
          plex_tv_section_id: plexSectionId.value,
        }
        if (plexToken.value) body.plex_token = plexToken.value
        const r = await api('POST', '/api/plex-refresh', body)
        if (r.triggered) setPlexStatus(`Plex refresh sent (HTTP ${r.status}).`)
        else if (r.skipped) setPlexStatus(`Not configured: ${r.reason}.`, 'info', 6000)
        else setPlexStatus(`Plex refresh failed: ${r.error}.`, 'err', 8000)
      } catch (err) {
        setPlexStatus(`Plex refresh failed: ${err.message}`, 'err', 8000)
      } finally {
        plexRefreshing.value = false
      }
    }

    const useCandidate = (c) => {
      fetchIp.value = c.ip
      fetchPort.value = String(c.port)
      candidates.value = []
      flash({
        msg: `Selected ${c.friendlyName || c.modelName || 'Fetch TV'}. Click Save to persist.`,
        ms: 5000,
      })
    }

    const discover = async () => {
      discovering.value = true
      candidates.value = []
      flash({ msg: 'Scanning the network for Fetch TV boxes (~3s)…', kind: 'info', ms: 0 })
      try {
        const { servers = [] } = await api('POST', '/api/discover-fetch')
        if (servers.length === 0) {
          flash({ msg: 'No Fetch TV boxes found. Enter the IP manually.', kind: 'err', ms: 5000 })
        } else if (servers.length === 1) {
          useCandidate(servers[0])
        } else {
          candidates.value = servers
          flash({ msg: `Found ${servers.length} boxes — choose one below.`, kind: 'info', ms: 5000 })
        }
      } catch (err) {
        flash({ msg: `Discovery failed: ${err.message}`, kind: 'err', ms: 5000 })
      } finally {
        discovering.value = false
      }
    }

    return {
      fetchIp, fetchPort, syncCron, syncCronEffective,
      plexUrl, plexToken, plexTokenSet, plexSectionId, plexSections,
      plexProbing, plexRefreshing, plexDetecting,
      plexTokenStatus, plexTokenStatusKind,
      plexDiscovering, plexCandidates, plexPrefsPath,
      fetchCloudActivationCode, fetchCloudPin, fetchCloudPinSet,
      fetchCloudTerminalId, fetchCloudTerminals, fetchCloudTesting,
      fetchCloudStatus, fetchCloudStatusKind, deleteAfterPlexRefreshOnly,
      adRemovalEnabled, adOriginalRetentionDays, comskipIniOverride,
      status, statusKind, plexStatus, plexStatusKind, saving, discovering, candidates,
      nuking, nukeState, reopenWizard,
      mediaRoot, mediaRootTesting, mediaRootStatus, mediaRootStatusKind, testMediaRoot,
      save, discover, useCandidate, loadPlexSections, refreshPlexNow, detectPlexToken,
      discoverPlex, usePlexCandidate,
      testFetchCloud,
    }
  },
}

const WelcomeView = {
  template: `
    <div class="view-reveal space-y-6">
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">{{ stepTitle }} · STEP {{ step }} / {{ totalSteps }}</span>
          <button type="button" class="btn-link" @click="skipToSettings">SKIP TO SETTINGS →</button>
        </header>
        <div class="panel-body space-y-4">

          <div v-if="step === 1" class="space-y-4">
            <p class="text-ink text-base leading-relaxed">
              Fetcharr watches your <strong class="text-signal-magenta">Fetch TV</strong> PVR for new recordings of shows you follow, downloads them into your <strong class="text-plex-yellow">Plex</strong> library, and (optionally) deletes them from the box afterwards.
            </p>
            <p class="text-ink-dim text-sm leading-relaxed">
              This wizard takes about two minutes. The only required step is pointing Fetcharr at your Fetch TV box — Plex and Fetch Cloud are optional.
            </p>
            <p v-if="hasExistingConfig" class="text-xs font-mono text-plex-yellow">
              ● RETURN VISIT — your existing settings are prefilled. Leave a field as-is to keep its stored value; stored secrets show as <code>••••• (stored)</code>.
            </p>
          </div>

          <div v-if="step === 2" class="space-y-4">
            <p class="text-ink text-sm leading-relaxed">
              Fetcharr needs to know where your Fetch TV box is on the network. Click <strong>Auto-discover</strong> to scan via SSDP, or enter the IP manually.
            </p>
            <div class="grid gap-4 md:grid-cols-2">
              <div class="field-row">
                <label class="field-label">Fetch TV IP</label>
                <input type="text" class="field-input" v-model="fetchIp" placeholder="e.g. 192.168.1.50" />
              </div>
              <div class="field-row">
                <label class="field-label">Fetch TV port</label>
                <input type="number" class="field-input" v-model="fetchPort" placeholder="49152" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="discover" :disabled="discovering">
                {{ discovering ? 'SCANNING…' : '◎ AUTO-DISCOVER' }}
              </button>
              <span v-if="fetchDiscoverText"
                :class="['status-readout', fetchDiscoverKind]">{{ fetchDiscoverText }}</span>
            </div>
            <div v-if="candidates.length > 1" class="space-y-2">
              <p class="text-sm text-ink-dim">Multiple Fetch TV boxes found — pick one:</p>
              <ul class="space-y-2">
                <li v-for="c in candidates" :key="c.ip">
                  <button type="button" class="btn" @click="useCandidate(c)">
                    Use {{ c.friendlyName || c.modelName || 'Fetch TV' }} ({{ c.ip }}:{{ c.port }})
                  </button>
                </li>
              </ul>
            </div>
            <p v-if="!fetchIp" class="text-xs text-signal-yellow font-mono">
              IP is required to continue.
            </p>
          </div>

          <div v-if="step === 3" class="space-y-4">
            <p class="text-ink text-sm leading-relaxed">
              Where Fetcharr writes downloads inside the container. Leave blank to fall back to <code>MEDIA_ROOT</code> env (default <code>/media/tv</code>).
            </p>
            <div class="field-row">
              <label class="field-label">Media root <span class="text-ink-mute">(inside container)</span></label>
              <input type="text" class="field-input" v-model="mediaRoot" placeholder="/media/tv" />
              <div class="flex flex-wrap items-center gap-3 mt-2">
                <button type="button" class="btn btn-sm" @click="testMediaRoot" :disabled="mediaRootTesting">
                  {{ mediaRootTesting ? 'TESTING…' : '↯ TEST PATH' }}
                </button>
                <span v-if="mediaRootStatus" :class="['status-readout', mediaRootStatusKind]">{{ mediaRootStatus }}</span>
              </div>
              <p class="text-xs text-ink-mute mt-2 leading-relaxed">
                Must match a bind-mount target in your <code>docker-compose.yml</code> — changing it without updating compose will silently fail.
              </p>
            </div>
          </div>

          <div v-if="step === 4" class="space-y-4">
            <p class="text-ink text-sm leading-relaxed">
              <strong>Optional.</strong> Connect to <strong class="text-plex-yellow">Plex</strong> so Fetcharr can trigger a library refresh after each sync. Skip if you don't use Plex.
            </p>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="discoverPlex" :disabled="plexDiscovering">
                {{ plexDiscovering ? 'SCANNING…' : '◎ AUTO-DISCOVER PLEX' }}
              </button>
              <span v-if="plexDiscoverText"
                :class="['status-readout', plexDiscoverKind]">{{ plexDiscoverText }}</span>
            </div>
            <div v-if="plexCandidates.length > 1" class="space-y-2">
              <p class="text-sm text-ink-dim">Multiple Plex servers found — pick one:</p>
              <ul class="space-y-2">
                <li v-for="c in plexCandidates" :key="c.ip + ':' + c.port">
                  <button type="button" class="btn" @click="usePlexCandidate(c)">
                    Use {{ c.name || 'Plex' }} ({{ c.ip }}:{{ c.port }})
                  </button>
                </li>
              </ul>
            </div>
            <div class="grid gap-4">
              <div class="field-row">
                <label class="field-label">Plex URL</label>
                <input type="text" class="field-input" v-model="plexUrl" placeholder="http://127.0.0.1:32400" />
              </div>
              <div class="field-row">
                <label class="field-label">Plex token</label>
                <input type="password" class="field-input" v-model="plexToken"
                  :placeholder="plexTokenSet ? '••••• (stored)' : 'X-Plex-Token'" autocomplete="off" />
                <div class="mt-2 flex flex-wrap items-center gap-3">
                  <button type="button" class="btn btn-sm" @click="detectPlexToken" :disabled="plexDetectingToken">
                    {{ plexDetectingToken ? 'DETECTING…' : '⚡ AUTO-DETECT TOKEN' }}
                  </button>
                  <span v-if="plexTokenStatus" :class="['status-readout', plexTokenStatusKind]">{{ plexTokenStatus }}</span>
                </div>
                <p class="text-xs text-ink-mute mt-2 leading-relaxed">
                  Reads <code>PlexOnlineToken</code> from Plex's <code>Preferences.xml</code> at the path below. Requires Plex to run on the same host as Fetcharr, with its config directory bind-mounted into the container. The URL field above isn't checked — if Plex's IP is your LAN address but Plex is on this machine, this still works.
                </p>
              </div>
              <div class="field-row">
                <label class="field-label">Preferences.xml path <span class="text-ink-mute">(inside container)</span></label>
                <input type="text" class="field-input" v-model="plexPrefsPath" placeholder="/plex-preferences.xml" />
                <p class="text-xs text-ink-mute mt-1 leading-relaxed">
                  Container-internal path. Requires a Docker bind-mount targeting this path. Edit if you mount Plex's <code>Preferences.xml</code> at a non-default location.
                </p>
              </div>
              <div class="field-row">
                <label class="field-label">Plex TV section</label>
                <select v-if="plexSections.length" class="field-input" v-model="plexSectionId">
                  <option value="">— pick a section —</option>
                  <option v-for="sec in plexSections" :key="sec.key" :value="sec.key">
                    {{ sec.title }} (#{{ sec.key }}, {{ sec.type }})
                  </option>
                </select>
                <input v-else type="text" class="field-input" v-model="plexSectionId" placeholder="numeric section ID" />
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <button type="button" class="btn" @click="loadPlexSections" :disabled="plexProbing">
                  {{ plexProbing ? 'PROBING…' : '⇣ LOAD SECTIONS' }}
                </button>
                <span v-if="plexSectionsText"
                  :class="['status-readout', plexSectionsKind]">{{ plexSectionsText }}</span>
              </div>
            </div>
          </div>

          <div v-if="step === 5" class="space-y-4">
            <p class="text-ink text-sm leading-relaxed">
              <strong>Optional.</strong> Sign in to Fetch's cloud so Fetcharr can delete recordings from the box after they sync. Skip if you don't want auto-delete.
            </p>
            <p class="text-ink-dim text-xs leading-relaxed">
              Get your activation code from
              <a href="https://www.fetchtv.com.au/manage/account/summary" target="_blank" rel="noopener noreferrer">fetchtv.com.au/manage/account/summary</a>
              under <em>Your Service → Boxes</em>. The PIN is the account PIN you set at activation.
            </p>
            <div class="grid gap-4 md:grid-cols-3">
              <div class="field-row">
                <label class="field-label">Activation code</label>
                <input type="text" class="field-input" v-model="fetchCloudActivationCode" placeholder="e.g. 12-digit number" autocomplete="off" />
              </div>
              <div class="field-row">
                <label class="field-label">PIN</label>
                <input type="password" class="field-input" v-model="fetchCloudPin"
                  :placeholder="fetchCloudPinSet ? '••••• (stored)' : '4-digit PIN'" autocomplete="off" />
              </div>
              <div class="field-row">
                <label class="field-label">Terminal ID</label>
                <select v-if="fetchCloudTerminals.length" class="field-input" v-model="fetchCloudTerminalId">
                  <option value="">— pick a box —</option>
                  <option v-for="t in fetchCloudTerminals" :key="t.id" :value="t.id" :disabled="!t.hasPvr">
                    {{ t.friendlyName || t.deviceType || 'Box' }} ({{ t.id }}){{ t.hasPvr ? '' : ' — no PVR' }}
                  </option>
                </select>
                <input v-else type="text" class="field-input" v-model="fetchCloudTerminalId" placeholder="auto-detected after Test" autocomplete="off" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <button type="button" class="btn" @click="testFetchCloud" :disabled="fetchCloudTesting">
                {{ fetchCloudTesting ? 'TESTING…' : '↯ TEST CONNECTION' }}
              </button>
              <span v-if="fetchCloudText"
                :class="['status-readout', fetchCloudKind]">{{ fetchCloudText }}</span>
            </div>
            <p class="text-xs text-ink-mute leading-relaxed">
              Test pings Fetch's cloud and lists the boxes on your account. If you only have one PVR, the Terminal ID auto-fills. If you have multiple, pick which box Fetcharr should manage.
            </p>
          </div>

          <div v-if="step === 6" class="space-y-4">
            <p class="text-ink text-base leading-relaxed">
              <span class="text-plex-yellow">●</span> You're set.
            </p>
            <p class="text-ink-dim text-sm leading-relaxed">
              Next: head to the <strong class="text-ink">Shows</strong> tab and add your first show. Fetcharr will pick it up on the next sync (every 30 minutes by default).
            </p>
          </div>

        </div>
        <div class="panel-body border-t border-hairline flex items-center justify-between gap-3 pt-4">
          <button type="button" class="btn" @click="back" :disabled="step === 1 || saving">← BACK</button>
          <div class="flex items-center gap-3">
            <span v-if="saveStatusText"
              :class="['status-readout', saveStatusKind]">{{ saveStatusText }}</span>
            <button type="button" class="btn btn-primary" @click="next" :disabled="!canAdvance || saving">
              {{ nextLabel }}
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
  setup() {
    const [fetchDiscoverText, fetchDiscoverKind, setFetchDiscover] = makeStatus()
    const [plexDiscoverText, plexDiscoverKind, setPlexDiscover] = makeStatus()
    const [plexSectionsText, plexSectionsKind, setPlexSections] = makeStatus()
    const [fetchCloudText, fetchCloudKind, setFetchCloud] = makeStatus()
    const [saveStatusText, saveStatusKind, setSaveStatus, clearSaveStatus] = makeStatus()
    const step = ref(1)
    const totalSteps = 6
    const STEP_TITLES = {
      1: 'WELCOME',
      2: 'FETCH TV BOX',
      3: 'STORAGE',
      4: 'PLEX',
      5: 'FETCH CLOUD ACCOUNT',
      6: 'READY',
    }
    const stepTitle = computed(() => STEP_TITLES[step.value] || 'WELCOME')
    const saving = ref(false)

    const fetchIp = ref('')
    const fetchPort = ref('')
    const discovering = ref(false)
    const candidates = ref([])

    const plexUrl = ref('')
    const plexToken = ref('')
    const plexSectionId = ref('')
    const plexSections = ref([])
    const plexProbing = ref(false)
    const plexDiscovering = ref(false)
    const plexCandidates = ref([])
    const plexDetectingToken = ref(false)
    const plexTokenStatus = ref('')
    const plexTokenStatusKind = ref('ok')
    const plexPrefsPath = ref('')

    const setPlexTokenStatus = (msg, kind = 'ok', ms = FLASH_DEFAULT_MS) => {
      plexTokenStatus.value = msg
      plexTokenStatusKind.value = kind
      if (ms > 0) setTimeout(() => (plexTokenStatus.value = ''), ms)
    }

    const fetchCloudActivationCode = ref('')
    const fetchCloudPin = ref('')
    const fetchCloudPinSet = ref(false)
    const fetchCloudTesting = ref(false)
    const fetchCloudTerminalId = ref('')
    const fetchCloudTerminals = ref([])

    const plexTokenSet = ref(false)

    const mediaRoot = ref('')
    const mediaRootTesting = ref(false)
    const mediaRootStatus = ref('')
    const mediaRootStatusKind = ref('ok')

    const hasExistingConfig = computed(() =>
      Boolean(fetchIp.value || plexUrl.value !== 'http://127.0.0.1:32400'
        || plexTokenSet.value || plexSectionId.value
        || fetchCloudActivationCode.value || fetchCloudPinSet.value
        || fetchCloudTerminalId.value),
    )

    onMounted(async () => {
      const s = await api('GET', '/api/settings').catch(() => ({}))
      fetchIp.value = s.fetch_ip || ''
      fetchPort.value = s.fetch_port || ''
      mediaRoot.value = s.media_root || ''
      plexUrl.value = s.plex_url || 'http://127.0.0.1:32400'
      plexTokenSet.value = Boolean(s.plex_token_set)
      plexSectionId.value = s.plex_tv_section_id || ''
      plexPrefsPath.value = s.plex_prefs_path || ''
      fetchCloudActivationCode.value = s.fetch_cloud_activation_code || ''
      fetchCloudPinSet.value = Boolean(s.fetch_cloud_pin_set)
      fetchCloudTerminalId.value = s.fetch_cloud_terminal_id || ''
    })

    const testMediaRoot = async () => {
      mediaRootTesting.value = true
      mediaRootStatus.value = ''
      try {
        const r = await api('POST', '/api/media-root-test', { path: mediaRoot.value })
        if (r.ok) {
          mediaRootStatus.value = `OK — ${r.path} is writable.`
          mediaRootStatusKind.value = 'ok'
        } else {
          mediaRootStatus.value = r.error
          mediaRootStatusKind.value = 'err'
        }
      } catch (err) {
        mediaRootStatus.value = `Test failed: ${err.message}`
        mediaRootStatusKind.value = 'err'
      } finally {
        mediaRootTesting.value = false
      }
    }

    let sectionAutoLoadTimer = null
    watch([plexUrl, plexToken], ([url, token]) => {
      clearTimeout(sectionAutoLoadTimer)
      if (!url || !token || plexSections.value.length) return
      sectionAutoLoadTimer = setTimeout(() => loadPlexSections({ silent: true }), 600)
    })

    const canAdvance = computed(() => {
      if (step.value === 2) return Boolean(fetchIp.value.trim())
      return true
    })

    const nextLabel = computed(() => {
      if (step.value === totalSteps) return 'GO TO SHOWS →'
      if (step.value === 2) return 'SAVE & NEXT →'
      if (step.value === 3) return mediaRoot.value ? 'SAVE & NEXT →' : 'SKIP →'
      if (step.value === 4) {
        const hasPlex = plexUrl.value || plexToken.value || plexSectionId.value
        return hasPlex ? 'SAVE & NEXT →' : 'SKIP →'
      }
      if (step.value === 5) {
        const hasCloud = fetchCloudActivationCode.value || fetchCloudPin.value
        return hasCloud ? 'SAVE & NEXT →' : 'SKIP →'
      }
      return 'NEXT →'
    })

    const dismiss = () => {
      try { localStorage.setItem(WELCOME_DISMISSED_KEY, '1') } catch { /* private mode */ }
    }

    const skipToSettings = () => {
      dismiss()
      window.location.hash = '#/settings'
    }

    const back = () => {
      if (step.value > 1) {
        clearSaveStatus()
        step.value--
      }
    }

    const next = async () => {
      if (step.value === totalSteps) {
        dismiss()
        window.location.hash = '#/shows'
        return
      }
      clearSaveStatus()
      saving.value = true
      try {
        if (step.value === 2) {
          await api('POST', '/api/settings', {
            fetch_ip: fetchIp.value.trim(),
            fetch_port: fetchPort.value,
          })
        } else if (step.value === 3) {
          await api('POST', '/api/settings', {
            media_root: mediaRoot.value,
          })
        } else if (step.value === 4) {
          const body = {
            plex_url: plexUrl.value,
            plex_tv_section_id: plexSectionId.value,
            plex_prefs_path: plexPrefsPath.value,
          }
          if (plexToken.value) body.plex_token = plexToken.value
          await api('POST', '/api/settings', body)
        } else if (step.value === 5) {
          const body = {
            fetch_cloud_activation_code: fetchCloudActivationCode.value,
            fetch_cloud_terminal_id: fetchCloudTerminalId.value,
          }
          if (fetchCloudPin.value) body.fetch_cloud_pin = fetchCloudPin.value
          await api('POST', '/api/settings', body)
        }
        step.value++
      } catch (err) {
        setSaveStatus(`Save failed: ${err.message}`, 'err', 5000)
      } finally {
        saving.value = false
      }
    }

    const useCandidate = (c) => {
      fetchIp.value = c.ip
      fetchPort.value = String(c.port)
      candidates.value = []
      setFetchDiscover(`Selected ${c.friendlyName || c.modelName || 'Fetch TV'}.`, 'ok', 5000)
    }

    const discover = async () => {
      discovering.value = true
      candidates.value = []
      setFetchDiscover('Scanning the network for Fetch TV boxes (~3s)…', 'info', 0)
      try {
        const { servers = [] } = await api('POST', '/api/discover-fetch')
        if (servers.length === 0) {
          setFetchDiscover('No Fetch TV boxes found. Enter the IP manually.', 'err', 5000)
        } else if (servers.length === 1) {
          useCandidate(servers[0])
        } else {
          candidates.value = servers
          setFetchDiscover(`Found ${servers.length} boxes — choose one below.`, 'info', 5000)
        }
      } catch (err) {
        setFetchDiscover(`Discovery failed: ${err.message}`, 'err', 5000)
      } finally {
        discovering.value = false
      }
    }

    const loadPlexSections = async ({ silent = false } = {}) => {
      plexProbing.value = true
      try {
        const body = { plex_url: plexUrl.value }
        if (plexToken.value) body.plex_token = plexToken.value
        const { sections = [] } = await api('POST', '/api/plex-sections', body)
        plexSections.value = sections
        if (!silent || sections.length) {
          setPlexSections(`Loaded ${sections.length} Plex sections.`, 'ok', 5000)
        }
      } catch (err) {
        if (!silent) setPlexSections(`Plex probe failed: ${err.message}`, 'err', 5000)
      } finally {
        plexProbing.value = false
      }
    }

    const discoverPlex = async () => {
      plexDiscovering.value = true
      plexCandidates.value = []
      setPlexDiscover('Broadcasting GDM (~2s)…', 'info', 0)
      try {
        const { servers = [] } = await api('POST', '/api/discover-plex')
        if (servers.length === 0) {
          setPlexDiscover('No Plex servers found on the LAN.', 'err', 5000)
        } else if (servers.length === 1) {
          usePlexCandidate(servers[0])
        } else {
          plexCandidates.value = servers
          setPlexDiscover(`Found ${servers.length} Plex servers — choose one below.`, 'info', 5000)
        }
      } catch (err) {
        setPlexDiscover(`Plex discovery failed: ${err.message}`, 'err', 5000)
      } finally {
        plexDiscovering.value = false
      }
    }

    const usePlexCandidate = (c) => {
      plexUrl.value = `http://${c.ip}:${c.port}`
      plexCandidates.value = []
      setPlexDiscover(`Selected ${c.name || 'Plex'} at ${c.ip}:${c.port}.`, 'ok', 5000)
    }

    const detectPlexToken = async () => {
      plexDetectingToken.value = true
      try {
        if (plexPrefsPath.value) {
          await api('POST', '/api/settings', { plex_prefs_path: plexPrefsPath.value })
        }
        const r = await api('POST', '/api/plex-detect-token')
        if (r.ok) {
          plexToken.value = r.token || ''
          setPlexTokenStatus(`Token detected from ${r.source}.`, 'ok', 5000)
        } else {
          setPlexTokenStatus(`Auto-detect failed: ${r.reason}`, 'err', 8000)
        }
      } catch (err) {
        setPlexTokenStatus(`Auto-detect failed: ${err.message}`, 'err', 8000)
      } finally {
        plexDetectingToken.value = false
      }
    }

    const testFetchCloud = async () => {
      fetchCloudTesting.value = true
      setFetchCloud('Authenticating…', 'info', 0)
      try {
        const body = {}
        if (fetchCloudActivationCode.value) body.activation_code = fetchCloudActivationCode.value
        if (fetchCloudPin.value) body.pin = fetchCloudPin.value
        const r = await api('POST', '/api/fetch-cloud-test', body)
        fetchCloudTerminals.value = r.terminals || []
        if (r.terminal_id_detected && !fetchCloudTerminalId.value) {
          fetchCloudTerminalId.value = r.terminal_id_detected
        }
        const n = (r.terminals || []).length
        const where = n === 1 ? '1 box' : `${n} boxes`
        setFetchCloud(`Connected — found ${where} on this account.`, 'ok', 5000)
      } catch (err) {
        setFetchCloud(`Failed: ${err.message}`, 'err', 5000)
      } finally {
        fetchCloudTesting.value = false
      }
    }

    return {
      step, totalSteps, stepTitle, saving, canAdvance, nextLabel, hasExistingConfig,
      fetchIp, fetchPort, discovering, candidates,
      plexUrl, plexToken, plexTokenSet, plexSectionId, plexSections, plexProbing,
      plexDiscovering, plexCandidates, plexDetectingToken, plexPrefsPath,
      plexTokenStatus, plexTokenStatusKind,
      fetchCloudActivationCode, fetchCloudPin, fetchCloudPinSet, fetchCloudTesting,
      fetchCloudTerminalId, fetchCloudTerminals,
      mediaRoot, mediaRootTesting, mediaRootStatus, mediaRootStatusKind, testMediaRoot,
      back, next, skipToSettings, discover, useCandidate, loadPlexSections, testFetchCloud,
      discoverPlex, usePlexCandidate, detectPlexToken,
      fetchDiscoverText, fetchDiscoverKind,
      plexDiscoverText, plexDiscoverKind,
      plexSectionsText, plexSectionsKind,
      fetchCloudText, fetchCloudKind,
      saveStatusText, saveStatusKind,
    }
  },
}

const VIEW_MAP = {
  dashboard: DashboardView,
  shows: ShowsView,
  syncs: SyncsView,
  recordings: RecordingsView,
  settings: SettingsView,
  welcome: WelcomeView,
}

const TABS = [
  { key: 'dashboard',  label: 'DASHBOARD'  },
  { key: 'shows',      label: 'SHOWS'      },
  { key: 'syncs',      label: 'SYNCS'      },
  { key: 'recordings', label: 'RECORDINGS' },
  { key: 'settings',   label: 'SETTINGS'   },
]

const App = {
  template: `
    <div class="min-h-screen flex flex-col">
      <header class="sticky top-0 z-20 backdrop-blur-md bg-surface-deep/85 border-b border-hairline">
        <div class="max-w-6xl mx-auto px-6">
          <div class="flex items-center justify-between gap-4 py-3">
            <a href="#/dashboard" class="no-hover-underline flex items-center gap-3 no-underline text-ink">
              <svg viewBox="0 0 15.5 3" :class="['brand-mark', 'w-[39px]', 'h-[8px]', 'shrink-0', { syncing: syncStatus.activeSyncId }]" aria-hidden="true">
                <rect x="0"    y="0" width="4" height="3" fill="#009be4"/>
                <rect x="5.75" y="0" width="4" height="3" fill="#f10c69"/>
                <rect x="11.5" y="0" width="4" height="3" fill="#e2b03c"/>
              </svg>
              <span class="font-mono font-semibold text-lg tracking-[0.1em] text-ink">Fetcharr</span>
              <span class="hidden sm:inline text-xs font-mono uppercase tracking-[0.2em] text-ink-mute translate-y-[2px]"><span class="text-signal-magenta">//</span> fetch tv → plex bridge</span>
            </a>
            <div class="flex items-center gap-5">
              <div class="flex items-center gap-2">
                <span :class="['led-dot', 'sm', syncStatus.activeSyncId ? 'live' : 'idle']"></span>
                <span :class="['font-mono', 'text-xs', 'tracking-[0.18em]', syncStatus.activeSyncId ? 'text-signal-magenta' : 'text-ink-mute']">
                  {{ syncStatus.activeSyncId ? 'SYNC' : 'IDLE' }}
                </span>
                <span v-if="syncStatus.activeSyncId" class="hidden md:inline text-xs font-mono text-ink-dim">
                  · #{{ syncStatus.activeSyncId }}
                </span>
              </div>
              <div class="hidden md:flex items-center gap-2 font-mono text-xs">
                <span class="text-ink-mute uppercase tracking-[0.18em]">{{ tzShortName }}</span>
                <span class="text-plex-yellow">{{ clockReadout }}</span>
              </div>
            </div>
          </div>
          <nav class="flex flex-wrap items-end gap-4 pt-1">
            <a v-for="t in tabs" :key="t.key"
              :href="'#/' + t.key"
              :data-active="route === t.key"
              :class="['tab-led', 'block', 'px-1', 'py-2', 'font-mono', 'text-sm', 'tracking-[0.2em]', route === t.key ? 'text-ink' : 'text-ink-dim hover:text-ink']">
              {{ t.label }}
            </a>
          </nav>
        </div>
      </header>

      <main class="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        <component :is="currentView" :key="route" />
      </main>

      <footer class="border-t border-hairline">
        <div class="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-ink-mute">
          <span><a href="/#dashboard" class="no-underline text-ink">Fetcharr</a> · authless LAN service · self-hosted</span>
          <span class="tracking-[0.2em]">// {{ tzShortName }} {{ clockReadout }}</span>
        </div>
      </footer>
    </div>
  `,
  setup() {
    const currentView = computed(() => VIEW_MAP[route.value] || DashboardView)
    return {
      route, tabs: TABS, currentView,
      syncStatus, clockReadout, tzShortName,
    }
  },
}

const welcomeDismissed = () => {
  try { return localStorage.getItem(WELCOME_DISMISSED_KEY) === '1' } catch { return false }
}

fetch('/api/settings')
  .then((r) => r.json())
  .then((s) => {
    if (s.tz) tz.value = s.tz
    const hashIsExplicit = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase()
    if (!s.fetch_ip && !welcomeDismissed() && hashIsExplicit !== 'welcome') {
      window.history.replaceState(null, '', '#/welcome')
      route.value = 'welcome'
    }
  })
  .catch(() => {})

fetchSyncStatus().then(ensureSyncPolling)

const app = createApp(App)
app.component('summary-line', SummaryLine)
app.mount('#app')
