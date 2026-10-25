// "Jetzt pingen" under the softres list "Wer fehlt?": everyone sees the button,
// but the click is /event's — the orga's (like "Fehlende pingen").
const { commandFiles } = require("../../../src/commands/loader");
const { resolveBotAccess, ruleFor } = require("../../../src/services/discord/botAccess");
const button = require("../../../src/commands/event/softresPingButton");

const commands = commandFiles().map(([, file]) => require(file));

describe("commands/event/softresPingButton", () => {
    it("is the component softres-ping, judged by /event's rule", () => {
        expect(button.name).toBe("softres-ping");
        expect(button.accessOf).toBe("event");
        expect(typeof button.execute).toBe("function");
        expect(ruleFor("softres-ping", { commands, config: {} })).toMatchObject({ owner: "event", mode: "admins" });
    });

    it("lets the orga click and refuses a raider", () => {
        const config = { botCommandAccess: { event: { mode: "roles", roleIds: ["700000000000000001"] } }, adminRoleIds: ["700000000000000009"] };
        const ctx = { commands, config };
        expect(resolveBotAccess("softres-ping", { id: "1", roleIds: ["700000000000000001"] }, ctx)).toMatchObject({ allowed: true });
        expect(resolveBotAccess("softres-ping", { id: "2", roleIds: ["700000000000000009"] }, ctx)).toMatchObject({ allowed: true });
        expect(resolveBotAccess("softres-ping", { id: "3", roleIds: ["700000000000000005"] }, ctx)).toMatchObject({ allowed: false });
    });
});
