// Die Anmelde-Buttons unter der Event-Nachricht: Anmelden (gespeicherte Charaktere,
// Mehrfachauswahl), Klasse wählen (Klasse → Spec → Name), Spät/Vielleicht/Bank (erster
// Charakter bzw. Auswahl), Absagen mit Grund, Anmeldeschluss/geschlossen/abgesagt,
// Raider-Rolle, alte customIds.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/web/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const command = require("../../../src/commands/signup/eventButton");
const {
    parseButtonId, orderedValues, firstCharacterTo, withAddedCharacter, refusal,
} = require("../../../src/utils/signupButtons");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const sec = () => Math.floor(Date.now() / 1000);
const click = (action, extra = {}) => mockInteraction({ customId: `event-btn:eh-kara:${action}`, userId: ANNA, ...extra });
const replyOf = (i) => i.reply.mock.calls[0][0];
const updateOf = (i) => i.update.mock.calls[0][0];
const selectOf = (payload) => payload.components[0].components[0];
const stored = () => mocks.signups.get(`eh-kara/${ANNA}`);
const statuses = () => stored().characters.map((c) => [c.character, c.status]);

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-event-button.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.set("eh-kara", mocks.ownEvent());
});

function twoCharacters() {
    profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
    profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }] });
}

// mockInteraction does not pass `component` through; add it for the select steps.
function withComponent(interaction, component) {
    interaction.component = component;
    return interaction;
}

// #306 — was der Raider erfährt, wenn der Raid schon voll ist.
describe("Warteliste unter der Event-Nachricht (#306)", () => {
    const fill = (n) => {
        for (let i = 0; i < n; i += 1) {
            mocks.signups.set(`eh-kara/f${i}`, { userId: `f${i}`, character: `F${i}`, spec: "Mage-Fire", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
        }
    };

    it("speichert die Anmeldung als Bank und sagt es in derselben Antwort", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ size: 2 }));
        fill(2);
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const i = click("join");
        await command.execute(i);
        expect(stored().status).toBe("bench");
        const text = String(replyOf(i).content || "");
        expect(text).toContain("waiting list");
        expect(text).toContain("raid is full (2/2)");
    });

    it("lehnt die Anmeldung ab, wenn die Warteliste aus ist", async () => {
        mocks.events.set("eh-kara", mocks.ownEvent({ size: 2, overflow: "off" }));
        fill(2);
        profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
        const i = click("join");
        await command.execute(i);
        expect(stored()).toBeUndefined();
        expect(String(replyOf(i).content || "")).toContain("full (2/2)");
    });
});

describe("commands/signup/eventButton", () => {
    it("is routed by the button prefix and open to every raider", () => {
        expect(command).toMatchObject({ name: "event-btn", group: "signup", defaultAccess: "everyone" });
        expect(memberMayRun(command)).toBe(true);
        expect(memberMayRun(command, { botCommandAccess: { "event-btn": { mode: "admins" } } })).toBe(false);
    });

    it("keeps the handlers of older messages (select #287, button #254)", () => {
        expect(require("../../../src/commands/signup/eventJoin").name).toBe("event-join");
        expect(require("../../../src/commands/signup/eventSignup").name).toBe("event-signup");
    });

    it("reads its customIds", () => {
        expect(parseButtonId("event-btn:eh-kara:join")).toEqual({ eventId: "eh-kara", action: "join", status: "", arg: "" });
        expect(parseButtonId("event-btn:eh-kara:name:l:Priest-Holy")).toEqual({ eventId: "eh-kara", action: "name", status: "late", arg: "Priest-Holy" });
        expect(parseButtonId("event-btn:eh-kara:pick:a")).toMatchObject({ status: "" });
        expect(orderedValues(["b|X", "a|Y"], [{ value: "a|Y" }, { value: "b|X" }])).toEqual([{ character: "a", spec: "Y" }, { character: "b", spec: "X" }]);
    });

    describe("Anmelden", () => {
        it("signs up at once with the only fitting character", async () => {
            profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }, { key: "Priest-Shadow", gear: "none" }] });
            const i = click("join");
            await command.execute(i);
            expect(replyOf(i).flags).toBe(MessageFlags.Ephemeral);
            expect(replyOf(i).content).toBe("Saved for **Karazhan**:\n`1.` Zibbo · Holy – **Signed up**");
            expect(stored()).toMatchObject({ status: "signed", character: "Zibbo", spec: "Priest-Holy" });
        });

        it("offers several characters as a multi-select and saves them in listed order", async () => {
            twoCharacters();
            const i = click("join");
            await command.execute(i);
            const payload = replyOf(i);
            expect(payload.flags).toBe(MessageFlags.Ephemeral);
            expect(payload.content).toContain("up to 2 characters");
            const select = selectOf(payload);
            expect(select).toMatchObject({ custom_id: "event-btn:eh-kara:pick:s", min_values: 1, max_values: 2 });
            expect(select.options.map((o) => o.value)).toEqual(["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"]);
            // a fresh signup preselects nothing: picking is what saves
            expect(select.options.some((o) => o.default)).toBe(false);
            // below the characters the classes, for a new character (#303)
            expect(payload.components[1].components[0]).toMatchObject({ type: 3, custom_id: "event-btn:eh-kara:cls:s" });
            expect(payload.components[1].components[0].options.map((o) => o.value)).toContain("Mage");

            // values handed back out of order: the listed order decides the priority
            const pick = withComponent(mockInteraction({ customId: select.custom_id, userId: ANNA, values: ["zibbowar|Warrior-Protection", "zibbo|Priest-Holy"] }), select);
            await command.execute(pick);
            expect(updateOf(pick)).toMatchObject({ components: [], embeds: [] });
            expect(updateOf(pick).content).toContain("`2.` Zibbowar · Protection – **Signed up**");
            expect(statuses()).toEqual([["Zibbo", "signed"], ["Zibbowar", "signed"]]);

            // "Spät" moves the first; "Anmelden" again names the current characters (never preselected,
            // so picking the same ones saves) and sets them back to "Dabei"
            await command.execute(click("late"));
            const again = click("join");
            await command.execute(again);
            const next = replyOf(again);
            expect(next.content).toContain("So far: Zibbo · Holy (Late), Zibbowar · Protection (Signed up)");
            expect(selectOf(next).options.some((o) => o.default)).toBe(false);
            const same = withComponent(mockInteraction({ customId: select.custom_id, userId: ANNA, values: ["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"] }), selectOf(next));
            await command.execute(same);
            expect(statuses()).toEqual([["Zibbo", "signed"], ["Zibbowar", "signed"]]);
        });

        it("goes the class way without a profile character", async () => {
            const i = click("join");
            await command.execute(i);
            const payload = replyOf(i);
            expect(payload.content).toContain("No character in your profile yet");
            expect(selectOf(payload).custom_id).toBe("event-btn:eh-kara:cls:s");
            expect(selectOf(payload).options.map((o) => o.value)).toContain("Priest");
        });
    });

    describe("Klasse wählen", () => {
        it("walks class → spec → name, adds the character to the profile and signs up", async () => {
            const start = click("bench");
            await command.execute(start);
            expect(selectOf(replyOf(start)).custom_id).toBe("event-btn:eh-kara:cls:b");

            const cls = mockInteraction({ customId: "event-btn:eh-kara:cls:b", userId: ANNA, values: ["Priest"] });
            await command.execute(cls);
            const specs = updateOf(cls);
            expect(specs.content).toContain("**Priest** – which spec?");
            expect(selectOf(specs)).toMatchObject({ custom_id: "event-btn:eh-kara:spec:b" });
            expect(selectOf(specs).options.map((o) => o.value)).toContain("Priest-Holy");

            const spec = mockInteraction({ customId: "event-btn:eh-kara:spec:b", userId: ANNA, values: ["Priest-Holy"], member: { displayName: "Anna" } });
            spec.member = { displayName: "Anna" };
            await command.execute(spec);
            const modal = spec.showModal.mock.calls[0][0].toJSON();
            expect(modal.custom_id).toBe("event-btn:eh-kara:name:b:Priest-Holy");
            expect(modal.components[0].components[0]).toMatchObject({ custom_id: "character", value: "Anna" });

            const submit = mockInteraction({ customId: modal.custom_id, userId: ANNA, modal: true, options: { character: "Zibbo" } });
            await command.execute(submit);
            expect(updateOf(submit).content).toBe("Saved for **Karazhan**:\n`1.` Zibbo · Holy – **Bench**");
            expect(profiles.getProfile(ANNA).characters.map((c) => c.name)).toEqual(["Zibbo"]);
            expect(stored()).toMatchObject({ status: "bench", character: "Zibbo" });
        });

        it("adds a further character to an existing signup, up to three", async () => {
            twoCharacters();
            await command.execute(withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["zibbo|Priest-Holy"] }), null));
            const classBtn = click("class");
            await command.execute(classBtn);
            expect(selectOf(replyOf(classBtn)).custom_id).toBe("event-btn:eh-kara:cls:s");

            const submit = mockInteraction({ customId: "event-btn:eh-kara:name:s:Mage-Fire", userId: ANNA, modal: true, options: { character: "Zibbomage" } });
            await command.execute(submit);
            expect(statuses()).toEqual([["Zibbo", "signed"], ["Zibbomage", "signed"]]);
            const third = mockInteraction({ customId: "event-btn:eh-kara:name:s:Warrior-Protection", userId: ANNA, modal: true, options: { character: "Zibbowar" } });
            await command.execute(third);
            expect(statuses()).toEqual([["Zibbo", "signed"], ["Zibbomage", "signed"], ["Zibbowar", "signed"]]);
            const fourth = mockInteraction({ customId: "event-btn:eh-kara:name:s:Rogue-Combat", userId: ANNA, modal: true, options: { character: "Zibborog" } });
            await command.execute(fourth);
            expect(updateOf(fourth).content).toMatch(/already signed up with 3 characters/);
            expect(stored().characters).toHaveLength(3);
        });

        it("refuses a name the profile already has with another class", async () => {
            twoCharacters();
            const submit = mockInteraction({ customId: "event-btn:eh-kara:name:s:Mage-Fire", userId: ANNA, modal: true, options: { character: "Zibbowar" } });
            await command.execute(submit);
            expect(updateOf(submit).content).toBe("⚠️ Zibbowar is already in your profile as a Warrior – pick another name.");
            expect(stored()).toBeUndefined();
        });
    });

    describe("Spät, Vielleicht, Bank", () => {
        it("moves only the first character of an existing signup", async () => {
            twoCharacters();
            await command.execute(withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"] }), null));
            const late = click("late");
            await command.execute(late);
            expect(replyOf(late).flags).toBe(MessageFlags.Ephemeral);
            expect(replyOf(late).content).toBe("Saved for **Karazhan**:\n`1.` Zibbo · Holy – **Late**\n`2.` Zibbowar · Protection – **Signed up**");
            expect(stored().status).toBe("late");
            expect(statuses()).toEqual([["Zibbo", "late"], ["Zibbowar", "signed"]]);
            // a single signup's one character goes to the status
            expect(firstCharacterTo({ status: "signed", characters: [{ character: "A", spec: "Mage-Fire" }] }, "bench")).toEqual([{ character: "A", spec: "Mage-Fire", status: "bench" }]);
            expect(firstCharacterTo({ status: "absence", characters: [] }, "bench")).toBeNull();
        });

        it("asks for the characters without a signup and saves them with that status", async () => {
            twoCharacters();
            const i = click("tentative");
            await command.execute(i);
            const payload = replyOf(i);
            expect(payload.content).toContain("as **Tentative**");
            const select = selectOf(payload);
            expect(select.custom_id).toBe("event-btn:eh-kara:pick:t");
            const pick = withComponent(mockInteraction({ customId: select.custom_id, userId: ANNA, values: select.options.map((o) => o.value) }), select);
            await command.execute(pick);
            expect(stored().status).toBe("tentative");
            expect(statuses().map(([, s]) => s)).toEqual(["tentative", "tentative"]);
        });

        it("Bank after an absence: saved as Bank, and the message lists the raider under Bank, not Abgemeldet", async () => {
            profiles.addCharacter(ANNA, { name: "Devire", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
            profiles.addCharacter(ANNA, { name: "Devheal", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
            await command.execute(withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["devire|Mage-Arcane"] }), null));
            await command.execute(mockInteraction({ customId: "event-btn:eh-kara:why", userId: ANNA, modal: true, options: { reason: "Arbeit" } }));
            expect(stored()).toMatchObject({ status: "absence" });

            // signed off: "Bank" cannot move a first character, it asks for one
            const bench = click("bench");
            await command.execute(bench);
            const select = selectOf(replyOf(bench));
            expect(select.custom_id).toBe("event-btn:eh-kara:pick:b");
            const pick = withComponent(mockInteraction({ customId: select.custom_id, userId: ANNA, values: ["devire|Mage-Arcane"] }), select);
            await command.execute(pick);
            expect(updateOf(pick).content).toBe("Saved for **Karazhan**:\n`1.` Devire · Arcane – **Bench**");
            expect(stored()).toMatchObject({ status: "bench", character: "Devire" });
            expect(statuses()).toEqual([["Devire", "bench"]]);

            // what the channel sees, built from the same store
            const { buildEventMessage } = require("../../../src/web/eventMessage");
            const payload = buildEventMessage(mocks.events.get("eh-kara"), mocks.signupStore().listSignups("eh-kara"));
            const lines = payload.embeds[0].fields.find((f) => !f.inline && /Bench|Absence/.test(f.value)).value.split("\n");
            expect(lines).toEqual(["Bench (1): `1` Devire"]);
        });

        it("keeps a character that is re-added in its place", () => {
            const signup = { status: "signed", characters: [{ character: "A", spec: "Mage-Fire", status: "late" }, { character: "B", spec: "Priest-Holy", status: "signed" }] };
            expect(withAddedCharacter(signup, { character: "b", spec: "Priest-Shadow", status: "signed" }).characters.map((c) => c.spec)).toEqual(["Mage-Fire", "Priest-Shadow"]);
            expect(withAddedCharacter(null, { character: "C", spec: "Mage-Fire", status: "bench" })).toEqual({ characters: [{ character: "C", spec: "Mage-Fire", status: "bench" }], status: "bench" });
        });
    });

    describe("Bestätigung mit Icons (#303)", () => {
        const appEmojis = require("../../../src/web/appEmojis");
        afterEach(() => appEmojis.resetAppEmojis());

        it("puts the spec and status icons into the confirmation when the emojis are there", async () => {
            twoCharacters();
            appEmojis.setAppEmojis(appEmojis.emojiCatalog().map((e, i) => ({ id: String(900 + i), name: e.name })));
            const pick = withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:b", userId: ANNA, values: ["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"] }), null);
            await command.execute(pick);
            const lines = updateOf(pick).content.replace(/:\d+>/g, ">").split("\n");
            expect(lines).toEqual([
                "<:eh_ui_signed> Saved for **Karazhan**",
                "`1` <:eh_priest_holy> Zibbo · Holy  ·  <:eh_ui_bench> **Bench**",
                "`2` <:eh_warrior_protection> Zibbowar · Protection  ·  <:eh_ui_bench> **Bench**",
            ]);
            const submit = mockInteraction({ customId: "event-btn:eh-kara:why", userId: ANNA, modal: true, options: { reason: "Arbeit" } });
            await command.execute(submit);
            expect(replyOf(submit).content.replace(/:\d+>/g, ">")).toBe("<:eh_ui_absence> Signed off from **Karazhan** – reason: Arbeit.");
        });
    });

    describe("Absagen", () => {
        it("opens a modal for the reason and signs off with it, answering only the member", async () => {
            twoCharacters();
            await command.execute(withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["zibbo|Priest-Holy"] }), null));
            const btn = click("absence");
            await command.execute(btn);
            const modal = btn.showModal.mock.calls[0][0].toJSON();
            expect(modal.custom_id).toBe("event-btn:eh-kara:why");
            expect(modal.components[0].components[0]).toMatchObject({ custom_id: "reason", required: true, min_length: 2, max_length: 100 });

            const submit = mockInteraction({ customId: "event-btn:eh-kara:why", userId: ANNA, modal: true, options: { reason: "Arbeit" } });
            await command.execute(submit);
            // the modal came from the public message: reply, never edit that message
            expect(submit.update).not.toHaveBeenCalled();
            expect(replyOf(submit)).toEqual({ content: "Signed off from **Karazhan** – reason: Arbeit.", flags: MessageFlags.Ephemeral });
            expect(stored()).toMatchObject({ status: "absence", comment: "Arbeit", character: "Zibbo" });
        });

        it("signs off without an earlier signup too", async () => {
            const submit = mockInteraction({ customId: "event-btn:eh-kara:why", userId: ANNA, modal: true, options: { reason: "Urlaub" } });
            await command.execute(submit);
            expect(stored()).toMatchObject({ status: "absence", comment: "Urlaub" });
        });
    });

    describe("Phasen und Regeln", () => {
        it("after the deadline: no Anmelden, Spät and Absagen still work", async () => {
            twoCharacters();
            await command.execute(withComponent(mockInteraction({ customId: "event-btn:eh-kara:pick:s", userId: ANNA, values: ["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"] }), null));
            mocks.events.set("eh-kara", mocks.ownEvent({ signupDeadline: sec() - 60 }));
            const join = click("join");
            await command.execute(join);
            expect(replyOf(join).content).toBe("The signup deadline has passed – only “Late” or Absence now.");
            const late = click("late");
            await command.execute(late);
            expect(statuses()).toEqual([["Zibbo", "late"], ["Zibbowar", "signed"]]);
            const bench = click("bench");
            await command.execute(bench);
            expect(replyOf(bench).content).toMatch(/signup deadline/);
            const off = click("absence");
            await command.execute(off);
            expect(off.showModal).toHaveBeenCalled();
        });

        it("a closed signup takes only Absagen, a cancelled event nothing", async () => {
            mocks.events.set("eh-kara", mocks.ownEvent({ signupsClosed: true }));
            const late = click("late");
            await command.execute(late);
            expect(replyOf(late).content).toBe("Signups are closed – you can only sign off now.");
            const off = click("absence");
            await command.execute(off);
            expect(off.showModal).toHaveBeenCalled();

            mocks.events.set("eh-kara", mocks.ownEvent({ status: "cancelled" }));
            const cancelled = click("absence");
            await command.execute(cancelled);
            expect(cancelled.showModal).not.toHaveBeenCalled();
            expect(replyOf(cancelled).content).toBe("The event was cancelled.");
            expect(refusal(null, "signed")).toBe("This event no longer exists.");
        });

        it("asks for the raider role before anything else", async () => {
            twoCharacters();
            mocks.access.config = { categoryRoles: { "cat-1": ["role-raider"] } };
            mocks.events.set("eh-kara", mocks.ownEvent({ categoryId: "cat-1" }));
            mocks.access.roleIds = ["other"];
            const i = click("join");
            await command.execute(i);
            expect(replyOf(i).content).toBe("You need a raider role for this raid.");
            const cls = click("class");
            await command.execute(cls);
            expect(replyOf(cls).content).toBe("You need a raider role for this raid.");
        });

        it("answers a gone event in the right place", async () => {
            const gone = mockInteraction({ customId: "event-btn:eh-weg:join", userId: ANNA });
            await command.execute(gone);
            expect(replyOf(gone).content).toBe("This event no longer exists.");
            const step = mockInteraction({ customId: "event-btn:eh-weg:cls:s", userId: ANNA, values: ["Priest"] });
            await command.execute(step);
            expect(updateOf(step).content).toBe("This event no longer exists.");
        });
    });
});
