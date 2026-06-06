// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Ignore build output, deps, and config files not in tsconfig
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
