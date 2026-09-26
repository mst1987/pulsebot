// For suites that mock src/web/discord.js: discord.fetchTextChannel() and
// discord.isOnline() then read the client the suite hands to the mocked
// getClient(), with the real rules (textChannelOf runs for real) — so a suite
// keeps steering "bot offline", "channel missing" and "channel found" through
// getClient() alone.
//
// Factory mock:  jest.mock(".../web/discord", () => require("../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), ... }));
// Automock:      withClientHelpers(require(".../web/discord"));

function withClientHelpers(mock) {
    const actual = jest.requireActual("../../src/web/discord");
    mock.isOnline = jest.fn(() => {
        const client = mock.getClient();
        return !!client && (typeof client.isReady !== "function" || client.isReady());
    });
    mock.fetchTextChannel = jest.fn((channelId, notFound) => actual.textChannelOf(mock.getClient(), channelId, notFound));
    return mock;
}

module.exports = { withClientHelpers };
