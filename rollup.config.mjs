import buildTS from '@wessberg/rollup-plugin-ts';
import {terser} from 'rollup-plugin-terser';
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
        file: 'index.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'index.umd.js',
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
        file: 'perf.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'perf.umd.js',
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
        file: 'index.min.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'index.umd.min.js',
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
        file: 'perf.min.js',
        format: 'esm',
        sourcemap: true,
      },
      {
        file: 'perf.umd.min.js',
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
