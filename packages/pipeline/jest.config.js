module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/__tests__"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@ktree/common/(.*)$": "<rootDir>/../common/$1",
  },
  setupFilesAfterEnv: [],
  testTimeout: 10000,
  // Handle native modules and CommonJS properly
  transformIgnorePatterns: [
    "node_modules/(?!(tree-sitter|tree-sitter-typescript|tree-sitter-python|tree-sitter-javascript)/)",
  ],
  extensionsToTreatAsEsm: [".ts"],
  globals: {
    "ts-jest": {
      useESM: false,
    },
  },
};
