// eslint.config.js - Data-Pipeline (node-only, no React)
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
    {
        ignores: ['**/*.json', 'node_modules', 'WWDOAT'],
    },

    js.configs.recommended,
    stylistic.configs.customize({
        indent: 4,
        quotes: 'single',
        semi: true,
    }),

    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
        plugins: { import: importPlugin },
    },

    {
        rules: {
            '@stylistic/indent': ['warn', 4, { VariableDeclarator: 1, SwitchCase: 1 }],
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/comma-dangle': ['error', 'always-multiline'],
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/eol-last': ['error', 'always'],
            '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
            '@stylistic/object-curly-spacing': ['error', 'always'],
            '@stylistic/array-bracket-spacing': ['error', 'never'],
            '@stylistic/arrow-parens': ['error', 'always'],
            '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
            '@stylistic/max-len': ['warn', { code: 120, ignoreComments: true, ignoreStrings: true }],

            'prefer-const': 'error',
            'no-var': 'error',
            'prefer-template': 'error',
            'arrow-body-style': ['error', 'as-needed'],
            'prefer-arrow-callback': 'error',
            'object-shorthand': ['error', 'always'],

            'no-console': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-shadow': 'error',
            'no-param-reassign': ['error', { props: false }],
            'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
            'no-nested-ternary': 'error',

            'import/order': [
                'error',
                {
                    'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                    'newlines-between': 'always',
                    'alphabetize': { order: 'asc', caseInsensitive: true },
                },
            ],
            'import/no-duplicates': 'error',
        },
    },
];
