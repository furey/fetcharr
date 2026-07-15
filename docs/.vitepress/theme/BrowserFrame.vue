<script setup>
import { withBase } from 'vitepress'
import { ref, onMounted } from 'vue'

const props = defineProps({
  src: { type: String, default: '/demo.mp4' },
  poster: { type: String, default: '/demo-poster.jpg' },
  label: { type: String, default: 'fetcharr' }
})

const video = ref(null)

onMounted(() => {
  const el = video.value
  if (!el) return
  el.muted = true
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (reduce?.matches) {
    el.removeAttribute('autoplay')
    el.pause()
    return
  }
  el.play?.().catch(() => {})
})
</script>

<template>
  <div class="browser-frame">
    <div class="browser-frame__bar" aria-hidden="true">
      <span class="browser-frame__dot browser-frame__dot--blue"></span>
      <span class="browser-frame__dot browser-frame__dot--magenta"></span>
      <span class="browser-frame__dot browser-frame__dot--yellow"></span>
      <span class="browser-frame__url">{{ label }}</span>
    </div>
    <div class="browser-frame__screen">
      <video
        ref="video"
        :poster="withBase(poster)"
        autoplay
        loop
        muted
        playsinline
        preload="metadata"
        aria-label="A walkthrough of the Fetcharr dashboard, shows, recordings, syncs, and settings"
      >
        <source :src="withBase(src)" type="video/mp4" />
      </video>
    </div>
  </div>
</template>

<style scoped>
.browser-frame {
  width: 100%;
  max-width: 1152px;
  margin: 4rem auto 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  box-shadow:
    0 24px 48px -24px rgba(0, 0, 0, 0.7),
    0 8px 20px -12px rgba(0, 0, 0, 0.5);
}

.browser-frame__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--vp-c-bg-elv);
  border-bottom: 1px solid var(--vp-c-divider);
}

.browser-frame__dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}

.browser-frame__dot--blue { background: #009be4; }
.browser-frame__dot--magenta { background: #f10c69; }
.browser-frame__dot--yellow { background: #e2b03c; }

.browser-frame__url {
  margin-left: 10px;
  padding: 3px 12px;
  border-radius: 6px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.browser-frame__screen {
  aspect-ratio: 1280 / 800;
  background: #1a1611;
}

.browser-frame__screen video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
