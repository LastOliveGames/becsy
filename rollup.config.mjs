export default {
  input: 'lib/index.js',
  external: ['util'],
  output: [
    {
      file: 'dist/index.cjs',
      format: 'cjs',
      sourcemap: true,
    },
    {
      file: 'dist/browser.js',
      name: 'becsy',
      format: 'iife',
      sourcemap: true,
      globals: {
        util: 'self'
      }
    }
  ]
};
