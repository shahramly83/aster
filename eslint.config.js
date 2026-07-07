import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Catch the temporal-dead-zone trap where a value (e.g. a useState const)
      // is read above its own declaration — that throws at render and blanks the
      // page, yet `vite build` stays green because it's a runtime error. Function
      // declarations are hoisted safely, so only flag variables/classes.
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
    },
  },
])
