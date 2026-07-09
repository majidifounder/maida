module.exports = {
  root: true,
  extends: ['../../packages/config/.eslintrc.base.js'],
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ['dist'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
};
