import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Postguy',
  description: 'A local-first desktop API workspace that remembers your responses.',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  markdown: {
    // Inline code is full of {{variable}} examples; keep Vue from reading them as templates.
    config(md) {
      const render = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (...args) => render(...args).replace('<code', '<code v-pre');
    },
  },
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${process.env.DOCS_BASE ?? '/'}icon.svg` }]],
  themeConfig: {
    logo: '/icon.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Scripts', link: '/guide/scripts' },
      { text: 'Shortcuts', link: '/reference/shortcuts' },
      { text: 'Download', link: 'https://github.com/paulcoding810/postguy/releases' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Requests and responses', link: '/guide/requests' },
          { text: 'GraphQL', link: '/guide/graphql' },
        ],
      },
      {
        text: 'Working with data',
        items: [
          { text: 'Variables and environments', link: '/guide/variables' },
          { text: 'Response memory and references', link: '/guide/memory' },
          { text: 'Examples', link: '/guide/examples' },
          { text: 'Auth', link: '/guide/auth' },
        ],
      },
      {
        text: 'Automation',
        items: [
          { text: 'Scripts', link: '/guide/scripts' },
          { text: 'Flows', link: '/guide/flows' },
          { text: 'Claude (MCP)', link: '/guide/claude' },
        ],
      },
      {
        text: 'Bringing work in and out',
        items: [
          { text: 'Import and export', link: '/guide/import-export' },
          { text: 'OpenAPI sync', link: '/guide/openapi' },
        ],
      },
      {
        text: 'Safety',
        items: [
          { text: 'History and undo', link: '/guide/history' },
          { text: 'Secrets', link: '/guide/secrets' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Keyboard shortcuts', link: '/reference/shortcuts' },
          { text: 'Building from source', link: '/reference/development' },
          { text: 'Releasing', link: '/reference/releasing' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/paulcoding810/postguy' }],
    search: { provider: 'local' },
    editLink: { pattern: 'https://github.com/paulcoding810/postguy/edit/main/docs/:path' },
  },
});
