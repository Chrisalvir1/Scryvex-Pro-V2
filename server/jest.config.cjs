module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/core/**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
};
