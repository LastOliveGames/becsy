import buildTS from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import ts from 'typescript';

const labeledBlockRemover = labels => {
  return context => {
    return sourceFile => {
      const visitor = node => {
        if (ts.isLabeledStatement(node) && labels.includes(node.label.escapedText)) return;
        return ts.visitEachChild(node, visitor, context);
      };
      return ts.visitNode(sourceFile, visitor);
    };
  };
};

export default [

  {
    input: 'src/index.ts',
    output: [
      {
        file: 'lib/index.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'lib/index.umd.js',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
    ],
    external: ['util'],
    plugins: [
      buildTS(),
    ]
  },

  {
    input: 'src/index.ts',
    output: [
      {
        file: 'lib/perf.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'lib/perf.umd.js',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
    ],
    external: ['util'],
    plugins: [
      buildTS({transformers: {before: [labeledBlockRemover(['CHECK', 'DEBUG', 'STATS'])]}}),
    ]
  },

  {
    input: 'src/index.ts',
    output: [
      {
        file: 'lib/index.min.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'lib/index.umd.min.js',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
    ],
    external: ['util'],
    plugins: [
      buildTS(), terser()
    ]
  },

  {
    input: 'src/index.ts',
    output: [
      {
        file: 'lib/perf.min.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'lib/perf.umd.min.js',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
    ],
    external: ['util'],
    plugins: [
      buildTS({transformers: {before: [labeledBlockRemover(['CHECK', 'DEBUG', 'STATS'])]}}),
      terser()
    ]
  }

];
