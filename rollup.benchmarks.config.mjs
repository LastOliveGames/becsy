import buildTS from 'rollup-plugin-ts';
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
    ],
    external: ['util'],
    plugins: [
      buildTS({transformers: {before: [labeledBlockRemover(['CHECK', 'DEBUG', 'STATS'])]}}),
    ]
  },
];
