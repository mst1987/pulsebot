const messages = require("../../src/config/messages");

describe("config/messages", () => {
    it("exports the expected top-level message groups", () => {
        for (const group of [
            "general",
            "gdkpraids",
            "mysetups",
            "lastspent",
            "currentspent",
            "totalspent",
            "signup",
            "common",
        ]) {
            expect(messages[group]).toBeDefined();
            expect(typeof messages[group]).toBe("object");
        }
    });

    it("gives every leaf value a string type", () => {
        for (const group of Object.values(messages)) {
            for (const value of Object.values(group)) {
                expect(typeof value).toBe("string");
            }
        }
    });

    it("uses 'Error' as the raider-facing error title and keeps 'Fehler' for GDKP", () => {
        expect(messages.general.errorTitle).toBe("Error");
        expect(messages.gdkpraids.errorTitle).toBe("Fehler");
    });

    it("keeps the error strings non-empty where they inform the user", () => {
        expect(messages.general.errorMessage).toContain("Raid-Helper bot");
        expect(messages.mysetups.errorMessage.length).toBeGreaterThan(0);
        expect(messages.signup.errorTitle).toBe("Signup not possible");
        expect(messages.signup.errorMessage).toBe("No matching raid found.");
    });

    it("keeps the ___replace___ placeholder intact in templated strings", () => {
        expect(messages.general.signups).toContain("___replace___");
        expect(messages.general.missingSignups).toContain("___replace___");
        expect(messages.gdkpraids.signups).toContain("___replace___");
        expect(messages.signup.successMessage).toContain("___replace___");
    });

    it("exposes the common ready/setup strings", () => {
        expect(messages.common.pulseBotReady).toBe("Pulse Bot is ready!");
        expect(messages.common.pulseBotSetupError.length).toBeGreaterThan(0);
    });
});
