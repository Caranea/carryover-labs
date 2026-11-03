// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: [
      'dist/',
      'api/dist/',
      'api/.test-build/',
      '.angular/',
      'artifacts/',
      'coverage/',
      'test-results/',
      'playwright-report/',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
      prettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    files: ['api/src/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'eval/**/*.{js,mjs}', 'eslint.config.js'],
    extends: [eslint.configs.recommended, prettier],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, prettier],
  },
  {
    files: ['**/*.ts'],
    ignores: ['**/*.d.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test doubles often stand in for only part of a type.
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
