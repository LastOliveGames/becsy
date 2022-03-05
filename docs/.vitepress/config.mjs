import {defineConfig} from 'vitepress';
import container from 'markdown-it-container';

export default defineConfig({
  base: '/becsy/',
  lang: 'en-US',
  title: 'Becsy',
  description: 'Multi-threaded Entity Component System framework for TS and JS.',
  lastUpdated: true,

  markdown: {
    config(md) {
      md.use(container, 'only-ts').use(container, 'only-js');
    }
  },

  themeConfig: {
    logo: '/logo.png',
    repo: 'lastolivegames/becsy',
    docsDir: 'docs',
    docsBranch: 'main',
    editLinks: true,
    editLinkText: 'Edit this page on GitHub',
    lastUpdated: 'Last updated',

    nav: [
      {text: 'Guide', link: '/', activeMatch: '^/$|^/guide/'},
      // TODO: generate API reference docs
      // {text: 'API Reference', link: '/api', activeMatch: '^/api/'},
      {text: 'Community', items: [
        {text: 'Discord', link: 'https://discord.gg/X72ct6hZSr'},
        {text: 'Issues', link: 'https://github.com/lastolivegames/becsy/issues'}
      ]},
      {text: 'Release Notes', link: 'https://github.com/lastolivegames/becsy/CHANGELOG.md'}
    ],

    sidebar: {
      '/guide/': getGuideSidebar(),
      '/': getGuideSidebar()
    },

    // TODO: configure search
    // algolia: {
    //   appId: '8J64VVRP8K',
    //   apiKey: 'a18e2f4cc5665f6602c5631fd868adfd',
    //   indexName: 'vitepress'
    // },
  }
});


function getGuideSidebar() {
  return [
    {
      text: 'Introduction',
      children: [
        {text: 'What is Becsy?', link: '/'},
        {text: 'Getting Started', link: '/guide/getting-started'},
        {text: 'Deploying', link: '/guide/deploying'}
      ]
    },
    {
      text: 'Architecture',
      children: [
        {text: 'Overview', link: '/guide/architecture/overview'},
        {text: 'World', link: '/guide/architecture/world'},
        {text: 'Components', link: '/guide/architecture/components'},
        {text: 'Entities', link: '/guide/architecture/entities'},
        {text: 'Systems', link: '/guide/architecture/systems'},
        {text: 'Queries', link: '/guide/architecture/queries'},
        {text: 'Multi-threading', link: '/guide/architecture/threading'}
      ]
    },
    {
      text: 'Examples',
      children: [
        {text: 'Overview', link: '/guide/examples/overview'},
        {text: 'Simple moving box', link: '/guide/examples/simple'}
      ]
    }
  ]
}
