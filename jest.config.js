module.exports = {
  preset: 'ts-jest',
  testEnvironment: '<rootDir>/__tests__/setup.util.ts',
  collectCoverage: false,
  testPathIgnorePatterns: [
    '<rootDir>/(dist|node_modules)/',
    '[.]js$',
    '[.]util[.][jt]s$',
    '[.]d[.][jt]s$',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '__tests__/tsconfig.json',
      },
    ],
  }
};
