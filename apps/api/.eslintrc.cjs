module.exports = {
  root: true,
  extends: ['../../packages/config/.eslintrc.base.js'],
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // TypeScript already validates return types; explicit annotations add noise in service layers.
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
  overrides: [
    {
      files: ['src/__tests__/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        'no-console': 'off',
      },
    },
  ],
};
