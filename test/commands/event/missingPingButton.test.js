// "Fehlende pingen" under the signup message: everyone sees the button, but the
// click is /event's — the orga's. The router (botAccess.guardInteraction) checks
// it before the handler runs; this is the rule it resolves.
const { commandFiles } = require("../../../src/commands/loader");
const { resolveBotAccess, ruleFor } = require("../../../src/services/discord/botAccess");
const button = require("../../../src/commands/event/missingPingButton");
const { handleMissingComponent } = require("../../../src/services/events/missingPingBot");

const commands = commandFiles().map(([, file]) => require(file));

describe("commands/event/missingPingButton", () => {
    it("is the component event-missing, judged by /event's rule", () => {
        expect(button.name).toBe("event-missing");
        expect(button.accessOf).toBe("event");
        expect(typeof button.execute).toBe("function");
        expect(typeof handleMissingComponent).toBe("function");
        expect(ruleFor("event-missing", { commands, config: {} })).toMatchObject({ owner: "event", mode: "admins" });
    });

    it("lets the orga click and refuses a raider", () => {
        const config = { botCommandAccess: { event: { mode: "roles", roleIds: ["700000000000000001"] } }, adminRoleIds: ["700000000000000009"] };
        const ctx = { commands, config };
        expect(resolveBotAccess("event-missing", { id: "1", roleIds: ["700000000000000001"] }, ctx)).toMatchObject({ allowed: true, reason: "role" });
        expect(resolveBotAccess("event-missing", { id: "2", roleIds: ["700000000000000009"] }, ctx)).toMatchObject({ allowed: true, reason: "admin" });
        expect(resolveBotAccess("event-missing", { id: "3", roleIds: ["700000000000000005"] }, ctx)).toMatchObject({ allowed: false, reason: "denied" });
        // without a rule of its own /event is admin-only — a raider is refused
        expect(resolveBotAccess("event-missing", { id: "3", roleIds: [] }, { commands, config: {} }).allowed).toBe(false);
    });
});
