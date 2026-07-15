import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repo = 'https://github.com/furey/fetcharr'
const site = 'https://furey.github.io/fetcharr/'

export default withMermaid(defineConfig({
  base: '/fetcharr/',
  lang: 'en-AU',
  title: 'fetcharr',
  description:
    'Sync Fetch TV PVR recordings into Plex. A self-hosted bridge for Australian Fetch TV DVB-T set-top boxes.',
  appearance: 'dark',
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,
  sitemap: { hostname: site },

  rewrites: {
    'DEEP_DIVE.md': 'deep-dive.md'
  },

  markdown: {
    config: (md) => {
      md.core.ruler.before('normalize', 'strip-alert-title-br', (state) => {
        state.src = state.src.replace(
          /(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])<br\s*\/?>/g,
          '$1'
        )
      })
    }
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/fetcharr/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#1a1611' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'fetcharr' }],
    ['meta', { property: 'og:title', content: 'fetcharr' }],
    ['meta', { property: 'og:description', content: 'Sync Fetch TV PVR recordings into Plex.' }],
    ['meta', { property: 'og:url', content: site }],
    ['meta', { name: 'twitter:card', content: 'summary' }]
  ],

  themeConfig: {
    siteTitle: 'fetcharr',

    nav: [
      { text: 'Guide', link: '/guide/', activeMatch: '/guide/' },
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Deep dive', link: '/deep-dive' }
    ],

    sidebar: [
      {
        text: 'Guide',
        collapsed: false,
        items: [
          { text: 'What Fetcharr is', link: '/guide/' },
          { text: 'Getting started', link: '/guide/getting-started' }
        ]
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [
          { text: 'Technical deep dive', link: '/deep-dive' }
        ]
      }
    ],

    outline: { level: [2, 3], label: 'On this page' },

    socialLinks: [{ icon: 'github', link: repo }],

    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub'
    },

    search: { provider: 'local' },

    lastUpdated: {
      text: 'Updated',
      formatOptions: { dateStyle: 'medium', timeStyle: 'short' }
    },

    docFooter: { prev: 'Previous', next: 'Next' },

    footer: {
      message: 'GPL-3.0-or-later. Not affiliated with or endorsed by Fetch TV or Plex.',
      copyright: `<a href="${repo}">Source on GitHub</a>`
    }
  },

  mermaid: {
    securityLevel: 'strict',
    flowchart: { useMaxWidth: true },
    themeVariables: { fontFamily: 'inherit' }
  }
}))
