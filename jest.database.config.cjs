module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/dist/tests'],
  testMatch: ['<rootDir>/dist/tests/database/**/*.test.js'],
  testTimeout: 20000,
  clearMocks: true,
  verbose: true,
  maxWorkers: 1,
};
