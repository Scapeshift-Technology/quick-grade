module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/functions', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'functions/**/*.ts',
    '!functions/**/*.d.ts',
  ],
  moduleNameMapper: {
    '^sst$': '<rootDir>/tests/__mocks__/sst.ts'
  }
}; 