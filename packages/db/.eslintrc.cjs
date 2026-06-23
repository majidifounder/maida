module.exports = {
  root: true,
  extends: ['../../packages/config/.eslintrc.base.js'],
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: ['dist'],
};
