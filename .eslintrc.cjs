module.exports = {
  env: {
    es2020: true, node: true
  },
  parserOptions: {
    sourceType: 'script'
  },
  plugins: ['lodash'],
  extends: [
    'eslint:recommended', 'plugin:import/recommended'
  ],
  ignorePatterns: ['node_modules', 'dist', 'build', '.cache'],
  overrides: [
    {
      files: ['src/**', 'tests/**'],
      parserOptions: {
        sourceType: 'module'
      },
      extends: ['plugin:lodash/recommended'],
      rules: {
        'lodash/chaining': ['error', 'implicit'],
        'lodash/import-scope': ['error', 'member'],
        'lodash/matches-prop-shorthand': 'off',
        'lodash/prefer-immutable-method': 'off',
        'lodash/prefer-invoke-map': 'off',
        'lodash/prefer-filter': 'off',
        'lodash/prefer-lodash-method': ['error', {
          ignoreMethods: ['split', 'replace']
        }],
        'lodash/prefer-map': 'off',
        'lodash/prop-shorthand': 'off',
      }
    },
    {
      files: ['src/recsy/**'],
      plugins: ['disable'],
      processor: 'disable/disable',
      settings: {
        'disable/plugins': ['lodash']
      }
    },
    {
      files: ['src/client/**'],
      env: {
        es2020: true, browser: true
      }
    },
    {
      files: ['**/*.ts'],
      extends: ['plugin:@typescript-eslint/recommended', 'plugin:import/typescript'],
      plugins: ['@typescript-eslint'],
      rules: {
        'no-invalid-this': 'off',
        'no-shadow': 'off',
        'no-unused-vars': 'off',
        'no-useless-constructor': 'off',
        'no-use-before-define': 'off',
        '@typescript-eslint/explicit-module-boundary-types': ['warn', {
          allowArgumentsExplicitlyTypedAsAny: true,
          allowDirectConstAssertionInArrowFunctions: true,
          allowedNames: [],
          allowHigherOrderFunctions: true,
          allowTypedFunctionExpressions: true,
        }],
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-invalid-this': 'error',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-shadow': 'error',
        '@typescript-eslint/no-unused-vars': ['error', {args: 'none'}],
        '@typescript-eslint/no-useless-constructor': 'error',
        '@typescript-eslint/no-use-before-define': ['error', {functions: false}],
      }
    }
  ],
  rules: {
    'accessor-pairs': 'error',
    'array-bracket-spacing': 'warn',
    'arrow-parens': ['error', 'as-needed'],
    'arrow-spacing': 'warn',
    'block-spacing': ['warn', 'never'],
    'brace-style': ['warn', '1tbs', {allowSingleLine: true}],
    'camelcase': 'error',
    'comma-spacing': 'warn',
    'comma-style': 'warn',
    'computed-property-spacing': 'warn',
    'curly': ['error', 'multi-line'],
    'dot-location': ['warn', 'property'],
    'dot-notation': 'warn',
    'eol-last': 'warn',
    'eqeqeq': 'error',
    'func-call-spacing': 'warn',
    'generator-star-spacing': 'warn',
    'getter-return': ['error', {allowImplicit: true}],
    'import/no-cycle': 'error',
    'indent': ['warn', 2, {
      SwitchCase: 1,
      MemberExpression: 'off',
      FunctionDeclaration: {parameters: 'off'},
      FunctionExpression: {parameters: 'off'}
    }],
    'key-spacing': ['warn', {mode: 'minimum'}],
    'keyword-spacing': 'warn',
    'linebreak-style': 'warn',
    'lines-between-class-members': ['warn', 'always', {exceptAfterSingleLine: true}],
    'max-len': ['warn', {
      code: 100,
      ignoreUrls: true,
      ignoreRegExpLiterals: true,
      ignorePattern: 'url\\(\'data:'
    }],
    'new-cap': ['error', {
      newIsCap: true, capIsNew: true, properties: true, capIsNewExceptions: [
        'Not',  // ecsy
        // babylon
        'Center', 'Clamp', 'Distance', 'DistanceSquared', 'Dot', 'Lerp', 'One', 'Zero'
      ]
    }],
    'new-parens': 'error',
    'no-alert': 'error',
    'no-array-constructor': 'error',
    'no-bitwise': ['error', {allow: ['~']}],
    'no-caller': 'error',
    'no-console': 'off',
    'no-constant-condition': ['error', {checkLoops: false}],
    'no-duplicate-imports': 'off',  // handled by import/no-duplicates instead
    'no-else-return': 'error',
    'no-empty-function': 'error',
    'no-eval': 'error',
    'no-extend-native': 'error',
    'no-extra-bind': 'error',
    'no-extra-label': 'error',
    'no-floating-decimal': 'error',
    'no-implicit-globals': 'error',
    'no-implied-eval': 'error',
    'no-invalid-this': 'error',
    'no-iterator': 'error',
    'no-lone-blocks': 'error',
    'no-lonely-if': 'error',
    'no-loop-func': 'error',
    'no-multi-spaces': ['warn', {ignoreEOLComments: true}],
    'no-multi-str': 'warn',
    'no-multiple-empty-lines': 'warn',
    'no-negated-condition': 'error',
    'no-new': 'error',
    'no-new-func': 'error',
    'no-new-object': 'error',
    'no-new-wrappers': 'error',
    'no-octal-escape': 'error',
    'no-proto': 'error',
    'no-script-url': 'error',
    'no-self-compare': 'error',
    'no-sequences': 'error',
    'no-shadow': 'error',
    'no-shadow-restricted-names': 'error',
    'no-tabs': 'warn',
    'no-template-curly-in-string': 'error',
    'no-throw-literal': 'error',
    'no-trailing-spaces': 'warn',
    'no-undef-init': 'error',
    'no-unexpected-multiline': 'off',
    'no-unmodified-loop-condition': 'error',
    'no-unneeded-ternary': 'error',
    'no-unused-expressions': 'error',
    'no-unused-vars': ['error', {args: 'none'}],
    'no-use-before-define': ['error', {functions: false}],
    'no-useless-call': 'error',
    'no-useless-computed-key': 'error',
    'no-useless-concat': 'error',
    'no-useless-constructor': 'error',
    'no-useless-rename': 'error',
    'no-useless-return': 'error',
    'no-var': 'error',
    'no-whitespace-before-property': 'warn',
    'no-with': 'error',
    'nonblock-statement-body-position': 'error',
    'object-curly-spacing': 'warn',
    'object-shorthand': 'error',
    'operator-linebreak': ['warn', 'after'],
    'prefer-arrow-callback': 'error',
    'prefer-const': 'error',
    'prefer-numeric-literals': 'error',
    'prefer-promise-reject-errors': 'error',
    'quotes': ['error', 'single', {allowTemplateLiterals: true}],
    'radix': 'error',
    'rest-spread-spacing': 'warn',
    'semi': 'error',
    'semi-spacing': 'warn',
    'semi-style': 'warn',
    'space-before-blocks': 'warn',
    'space-before-function-paren': ['warn', 'never'],
    'space-in-parens': 'warn',
    'space-infix-ops': 'warn',
    'space-unary-ops': ['warn', {words: true, nonwords: false}],
    'spaced-comment': 'warn',
    'switch-colon-spacing': 'warn',
    'template-curly-spacing': 'warn',
    'template-tag-spacing': 'warn',
    'unicode-bom': 'error',
    'yoda': 'error',
  }
};

