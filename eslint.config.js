import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'lib/**', '.local/**', '.tgcloud/**', 'docs/**'] },
  js.configs.recommended,
  {
    files: ['*.mjs', 'test/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.js', 'handlers/**/*.js', 'schema.js'],
    languageOptions: { globals: { ...globals.es2022, Buffer: 'readonly', console: 'readonly' } },
    rules: {
      'no-restricted-globals': [
        'error',
        'process',
        'require',
        'fetch',
        'setTimeout',
        'setInterval',
        'AbortController',
        'crypto',
      ],
    },
  },
  {
    files: ['src/**/*.js', '*.mjs', 'test/**/*.mjs', 'handlers/**/*.js', '*.js'],
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
];
