import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'work/**'] },
  js.configs.recommended,
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  ...ts.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-namespace': 'off',
    },
  },
);
