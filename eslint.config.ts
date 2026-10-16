import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';
import pluginOxlint from 'eslint-plugin-oxlint';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,

  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      // "@typescript-eslint/no-explicit-any": ["off"],
      'vue/multi-word-component-names': ['off'],
      '@typescript-eslint/no-unused-vars': ['warn'],
      // With `verbatimModuleSyntax`, an import not marked `type` is kept in the output, which fails
      // at runtime if the module only declares it as a type (e.g. `DataConnection` from `peerjs`).
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          // PeerJS's plain `close()` discards packets that are still in flight.
          selector: "CallExpression[callee.property.name='close'][arguments.length=0]",
          message:
            'Close PeerJS connections via `closeConnection` from `util/peerjs.ts`, which delivers pending packets first.',
        },
      ],
    },
  },

  {
    name: 'app/tests',
    files: ['src/**/__tests__/**'],
    rules: {
      // Tests close connections abruptly on purpose, to simulate network failures.
      'no-restricted-syntax': ['off'],
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('./.oxlintrc.json'),
);
