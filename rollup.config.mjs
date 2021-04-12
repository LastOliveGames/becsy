import buildTS from '@wessberg/rollup-plugin-ts';
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
        file: 'dist/index.cjs',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
      {
        file: 'dist/index.mjs',
        format: 'esm',
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
        file: 'dist/perf/index.cjs',
        name: 'becsy',
        format: 'umd',
        sourcemap: true,
      },
      {
        file: 'dist/perf/index.mjs',
        format: 'esm',
        sourcemap: true,
      },
    ],
    external: ['util'],
    plugins: [
      buildTS({transformers: {before: [labeledBlockRemover(['CHECK', 'DEBUG', 'STATS'])]}}),
    ]
  }

];
