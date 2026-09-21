const fs = require("fs");
const path = require("path");
const { toEnglish, RULES } = require("../../src/utils/botEnglish");

// German markers that must not survive a translation.
const GERMAN = /[äöüÄÖÜß]|\b(der|die|das|du|dich|deinem|nicht|nur|noch|bitte|kein|keine|ist|wurde|voll)\b/i;

/** The fixed (non-template) sentences a module hands to `fail(...)` / `error:` / `notice:`. */
function literalSentences(file, pattern) {
    const src = fs.readFileSync(path.join(__dirname, "../../src/web", file), "utf8");
    return [...src.matchAll(pattern)].map((m) => m[1]);
}

describe("utils/botEnglish", () => {
    it("translates every fixed refusal of the signup service", () => {
        const sentences = literalSentences("signupService.js", /fail\("[a-z_]+", "([^"]+)"\)/g);
        expect(sentences.length).toBeGreaterThan(8);
        for (const s of sentences) {
            const en = toEnglish(s);
            expect({ s, en }).toEqual({ s, en: expect.not.stringMatching(GERMAN) });
        }
    });

    it("translates the service's templated refusals and notices", () => {
        expect(toEnglish("Unbekannter Anmeldestatus „foo“.")).toBe("Unknown signup status “foo”.");
        expect(toEnglish("Höchstens 3 Charaktere je Anmeldung.")).toBe("At most 3 characters per signup.");
        expect(toEnglish("Zibbo steht nicht in deinem Profil.")).toBe("Zibbo is not in your profile.");
        expect(toEnglish("Diese Spezialisierung ist für Zibbo nicht im Profil hinterlegt.")).toBe("This spec is not in your profile for Zibbo.");
        expect(toEnglish("Der Raid ist voll (25/25) – es geht keine Anmeldung mehr. Frag die Raidleitung."))
            .toBe("The raid is full (25/25) – no more signups. Ask the raid lead.");
        expect(toEnglish("Der Raid ist voll (25/25) – du stehst auf der Warteliste (Bank). Ob jemand nachrückt, entscheidet die Raidleitung."))
            .toBe("The raid is full (25/25) – you are on the waiting list (bench). The raid lead decides who moves up.");
        expect(toEnglish("Keiner der gewählten Charaktere passt")).toBe("None of the picked characters fits");
        expect(toEnglish("Klasse passt nicht zu diesem Raid")).toBe("class does not fit this raid");
    });

    it("translates the profile store's errors", () => {
        expect(toEnglish("Bitte einen Namen angeben.")).toBe("Please enter a name.");
        expect(toEnglish("Bitte eine Klasse angeben.")).toBe("Please pick a class.");
        expect(toEnglish("Höchstens 10 Charaktere.")).toBe("At most 10 characters.");
    });

    it("translates every refusal of the character-name rule", () => {
        const { validateCharacterName } = require("../../src/utils/characterNames");
        const cases = [
            ["", {}], ["A B C", { lastName: true }], ["Aldric Sturmwind", { lastName: false }],
            ["Ab1", {}], ["Aldric St1", { lastName: true }], ["A1 Sturmwind", { lastName: true }],
            ["A", {}], ["A Sturmwind", { lastName: true }], ["Aldric S", { lastName: true }],
            ["Abcdefghijklm", {}], ["Abcdefghijklm Sturm", { lastName: true }], ["Aldric Abcdefghijklm", { lastName: true }],
            ["Fuckface", {}],
        ];
        for (const [name, opts] of cases) {
            const { error } = validateCharacterName(name, opts);
            expect(error).toBeTruthy();
            expect({ error, en: toEnglish(error) }).toEqual({ error, en: expect.not.stringMatching(GERMAN) });
        }
        expect(toEnglish("Der Vorname hat 13 Buchstaben – höchstens 12.")).toBe("The first name has 13 letters – at most 12.");
    });

    it("translates the setup's bench reasons", () => {
        expect(toEnglish("Raid voll (10/10)")).toBe("Raid full (10/10)");
        expect(toEnglish("Heiler voll (3/3)")).toBe("Healers full (3/3)");
        expect(toEnglish("Anwesenheit 42 %")).toBe("Attendance 42%");
        expect(toEnglish("War zuletzt dabei")).toBe("Was in the last raid");
        expect(toEnglish("Andere passten besser in die Aufstellung")).toBe("Others fitted the lineup better");
    });

    it("keeps a leading marker and works line by line", () => {
        expect(toEnglish("⚠️ Für diesen Raid brauchst du eine Raider-Rolle.")).toBe("⚠️ You need a raider role for this raid.");
        expect(toEnglish("✅ Saved\n⏳ Der Raid ist damit voll – die Anmeldung ist jetzt geschlossen."))
            .toBe("✅ Saved\n⏳ The raid is now full – signups are closed.");
    });

    it("passes unknown text, empty text and English through unchanged", () => {
        expect(toEnglish("Irgendwas Neues")).toBe("Irgendwas Neues");
        expect(toEnglish("")).toBe("");
        expect(toEnglish(null)).toBe("");
        expect(toEnglish("This event no longer exists.")).toBe("This event no longer exists.");
    });

    it("has no German left in any replacement", () => {
        for (const [, english] of RULES) expect(english).not.toMatch(GERMAN);
    });
});
