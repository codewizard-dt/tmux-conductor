// @ts-check
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Apply strictTypeChecked to TS/TSX files only (skip .astro — no Astro parser installed)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      // React 19 / new JSX transform — no need to import React in scope
      'react/react-in-jsx-scope': 'off',
      // TypeScript handles prop type validation
      'react/prop-types': 'off',
    },
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Ignore build output, generated files, and deps
    ignores: ['dist/**', 'node_modules/**', '.astro/**'],
  },
);
