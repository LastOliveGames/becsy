/* eslint-env node */
const {resolve} = require('path');
const {defineConfig} = require('vite');

module.exports = defineConfig({
  server: {
    fs: {
      allow: ['.']
    }
  },
  build: {
    target: ['esnext', 'chrome89', 'edge89', 'firefox89', 'safari15'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        simple: resolve(__dirname, 'simple/index.html'),
        simplejs: resolve(__dirname, 'simple-js/index.html')
      }
    }
  }
});
