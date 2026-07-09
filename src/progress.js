import prettyMs from 'pretty-ms'

export const setProgress = (fetchId, patch) => {
  const existing = registry.get(fetchId) || {}
  registry.set(fetchId, { ...existing, ...patch, updatedAt: Date.now() })
}

export const clearProgress = (fetchId) => {
  registry.delete(fetchId)
}

export const getProgress = (fetchId) => {
  const entry = registry.get(fetchId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > PROGRESS_STALE_MS) {
    registry.delete(fetchId)
    return null
  }
  return entry
}

export const snapshotProgress = (fetchIds) => {
  const snapshot = {}
  for (const fetchId of fetchIds) {
    const entry = getProgress(fetchId)
    if (entry) snapshot[fetchId] = entry
  }
  return snapshot
}

export const makeDownloadProgress = (fetchId) => {
  let total = 1
  let startBytes = 0
  const startedAt = Date.now()
  return {
    startTime: startedAt,
    setTotal: (t) => { total = Math.max(t, 1) },
    getTotal: () => total,
    update: (value, payload = {}) => {
      if (!startBytes) startBytes = value
      const elapsed = (Date.now() - startedAt) / 1000
      const rate = elapsed > 0.5 ? (value - startBytes) / elapsed : 0
      const etaSeconds = rate > 0 ? Math.max(0, (total - value) / rate) : null
      setProgress(fetchId, {
        phase: 'downloading',
        percent: Math.min(100, Math.round((value / total) * 100)),
        etaSeconds,
        etaLabel: formatEta(etaSeconds),
        detail: formatRate(payload.speed),
        startedAt,
      })
    },
    stop: () => clearProgress(fetchId),
  }
}

export const formatEta = (etaSeconds) =>
  etaSeconds == null ? null : prettyMs(etaSeconds * 1000, { secondsDecimalDigits: 0 })

const formatRate = (speed) => (speed && speed !== 'N/A' ? `${speed}/s` : null)

const registry = new Map()

const PROGRESS_STALE_MS = 30_000
