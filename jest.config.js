/** @type {import("jest").Config} */
module.exports = {
    testEnvironment: "node",
    testMatch: ["**/test/**/*.test.js"],
    clearMocks: true,
    collectCoverageFrom: [
        "src/**/*.js",
        "!src/bot.js",
        "!src/discordcommands/**",
    ],
    coverageDirectory: "coverage",
    // Silence the bot's console.error/log noise during tests.
    silent: true,
    // The bot schedules setTimeout timers (auto-deleting replies); force a clean
    // exit so lingering timers don't keep the Jest worker alive.
    forceExit: true,
};
