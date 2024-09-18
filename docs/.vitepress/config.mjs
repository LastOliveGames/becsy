import {defineConfig} from 'vitepress';
import container from 'markdown-it-container';
import {readFileSync} from 'fs';

export default defineConfig({
  base: '/becsy/',
  title: 'Becsy',
  titleTemplate: 'Becsy — :title',
  description: 'Multi-threaded Entity Component System framework for TS and JS.',
  cleanUrls: true,
  lastUpdated: true,

  markdown: {
    config(md) {
      md.use(container, 'only-ts').use(container, 'only-js');
    }
  },

  themeConfig: {
    logo: '/logo_small.png',
    repo: 'lastolivegames/becsy',
    editLink: {
      pattern: 'https://github.com/lastolivegames/becsy/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    outline: false,
    footer: {
      message: 'MIT Licensed',
      copyright: 'Copyright © 2021-present Piotr Kaminski'
    },
    search: {
      provider: 'local'
    },

    nav: [
      {text: 'Guide', link: '/guide/introduction', activeMatch: '^/guide/'},
      // TODO: generate API reference docs
      // {text: 'API Reference', link: '/api', activeMatch: '^/api/'},
      {text: 'Community', items: [
        {text: 'Discord', link: 'https://discord.gg/X72ct6hZSr'},
        {text: 'Issues', link: 'https://github.com/lastolivegames/becsy/issues'}
      ]},
      {text: 'Release Notes', link: 'https://github.com/LastOliveGames/becsy/blob/main/CHANGELOG.md'},
      {text: 'GitHub', link: 'https://github.com/lastolivegames/becsy'}
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          page('guide/introduction'),
          page('guide/getting-started'),
          page('guide/deploying')
        ]
      },
      {
        text: 'Architecture',
        items: [
          page('guide/architecture/overview'),
          page('guide/architecture/world'),
          page('guide/architecture/components'),
          page('guide/architecture/entities'),
          page('guide/architecture/systems'),
          page('guide/architecture/queries'),
          page('guide/architecture/threading')
        ]
      },
      {
        text: 'Examples',
        items: [
          page('guide/examples/overview'),
          page('guide/examples/simple')
        ]
      }
    ],
  }
});

function page(path) {
  const markdown = readFileSync(`docs/${path}.md`).toString();
  let currentLevel = 0, itemStack = [];
  for (const match of markdown.matchAll(/^(#+) (.*?)(?: +\{(?:#|id=)(.*?)\})?$/gm)) {
    const level = match[1].length, title = match[2];
    const slug =
      match[3] ||
      title.toLowerCase().replace(/[^a-z0-9\-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/, '');
    const item = {text: title, link: `/${path}#${slug}`};
    if (level === currentLevel) {
      itemStack.pop();
    } else if (level < currentLevel) {
      itemStack.pop();
      itemStack.pop();
    }
    const lastItem = itemStack.length ? itemStack[itemStack.length - 1] : null;
    if (lastItem) {
      lastItem.collapsed = true;
      lastItem.items = lastItem.items || [];
      lastItem.items.push(item);
    }
    itemStack.push(item);
    currentLevel = level;
  }
  return itemStack[0];
}
