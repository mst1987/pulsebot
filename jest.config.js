/** @type {import("jest").Config} */

// Settings every project shares. With `projects`, a project does not inherit
// the root's test options, so they live here and are spread into each one.
const shared = {
    rootDir: __dirname,
    // plain Node plus the test lifecycle the console buffer needs
    testEnvironment: "<rootDir>/test/setup/environment.js",
    clearMocks: true,
    // no test may reach the network (axios, http(s), fetch) - jest.mock instead
    setupFiles: ["<rootDir>/test/setup/noNetwork.js"],
    // a blocked request fails its test even when the code swallowed the error;
    // console output only shows up for a failing test (replaces `silent`)
    setupFilesAfterEnv: ["<rootDir>/test/setup/noNetworkCheck.js", "<rootDir>/test/setup/consoleBuffer.js"],
};

module.exports = {
    projects: [
        {
            ...shared,
            displayName: "unit",
            testMatch: ["<rootDir>/test/**/*.test.js"],
            testPathIgnorePatterns: ["/node_modules/", "<rootDir>/test/claude-hooks/"],
        },
        {
            // The Claude-Code hooks run real git repositories and are slow;
            // run them on their own with `npx jest --selectProjects hooks`.
            ...shared,
            displayName: "hooks",
            testMatch: ["<rootDir>/test/claude-hooks/**/*.test.js"],
        },
    ],
    // No `forceExit` (#432): every interval/timeout in src/ is unref()'d, so a
    // worker that does not exit points at a real leak - find it with
    // `npx jest --detectOpenHandles` instead of hiding it.
    // Coverage options are root-level: they apply across all projects.
    collectCoverageFrom: [
        "src/**/*.js",
        "!src/bot.js",
        // the built React bundle (src/web-client/dist) is not backend code
        "!src/web-client/**",
    ],
    coverageDirectory: "coverage",
    // About one point under what the suite reaches (measured 2026-09-26, #432):
    // coverage must not sink. A path key takes its files out of `global`;
    //   - a directory is checked as a whole (logcheck),
    //   - a glob is checked for EACH matching file (the stores), so its
    //     numbers sit under the weakest store, not under the average.
    coverageThreshold: {
        global: {
            lines: 93.8,
            functions: 92.9,
            branches: 77.2,
            statements: 90.8,
        },
        "./src/utils/logcheck/": {
            lines: 97.4,
            functions: 96.5,
            branches: 82.7,
            statements: 94.8,
        },
        "./src/web/**/*Store.js": {
            lines: 85.4,
            functions: 87.8,
            branches: 64.4,
            statements: 76,
        },
    },
};
