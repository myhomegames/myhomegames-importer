export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {},
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'importers/**/*.js',
    '!importers/**/__tests__/**'
  ]
};
