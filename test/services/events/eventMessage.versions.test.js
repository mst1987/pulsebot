// The event post names its game version, small (#743).
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: jest.fn(), setEventMessage: jest.fn(), listEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/signupStore", () => ({ listSignups: jest.fn(() => []), onSignupsChanged: jest.fn(() => () => {}) }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const { _internal: { buildEventMessage } } = require("../../../src/services/events/eventMessage");
const { event: baseEvent } = require("../../factories/events");

const NOW = 1999990000 * 1000;

describe("buildEventMessage version label (#743)", () => {
    it("puts the short version name in the footer", () => {
        const embed = buildEventMessage(baseEvent({ versionId: "forever", startTime: 2000000000 }), [], { now: NOW }).embeds[0];
        expect(embed.footer).toEqual({ text: "Forever" });
        const tbc = buildEventMessage(baseEvent({ versionId: "tbc", startTime: 2000000000 }), [], { now: NOW }).embeds[0];
        expect(tbc.footer).toEqual({ text: "TBC" });
    });
});
