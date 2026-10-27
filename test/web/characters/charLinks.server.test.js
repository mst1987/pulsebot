// charLinks with the server a page is shown for (#923): its own armory/log
// template wins, every other server and a call without one keep the standard.
const G1 = "111111111111111111";
jest.mock("../../../src/stores/configStore", () => ({
    getConfig: () => ({
        mainVersion: "tbc",
        versionSettings: { tbc: { armoryUrlTemplate: "https://armory.test/{char}", wclUrlTemplate: "https://wcl.test/character/eu/x/{char}" } },
        serverSettings: { "111111111111111111": { versionOverrides: { tbc: { wclUrlTemplate: "https://own-wcl.test/{char}" } } } },
    }),
}));

const { armoryUrlFor, wclUrlFor } = require("../../../src/web/characters/charLinks");

describe("web/characters/charLinks - per server (#923)", () => {
    it("takes the server's own log template and keeps the standard armory", () => {
        expect(wclUrlFor("Brokk", "tbc", G1)).toBe("https://own-wcl.test/Brokk");
        expect(armoryUrlFor("Brokk", "tbc", G1)).toBe("https://armory.test/Brokk");
    });

    it("keeps the standard without a server or for another one", () => {
        expect(wclUrlFor("Brokk", "tbc")).toBe("https://wcl.test/character/eu/x/Brokk");
        expect(wclUrlFor("Brokk", "tbc", "222222222222222222")).toBe("https://wcl.test/character/eu/x/Brokk");
    });
});
