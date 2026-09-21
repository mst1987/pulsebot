// Mehrere Raids auf einmal anmelden (#293): „Für alle Raids anmelden“ und
// „Mehrere Raids wählen …“ an der Raid-Übersicht, Schritt 1 (Raids + Status),
// das Charakter-Modal mit höchstens fünf Raids, „Weiter“ zur nächsten Seite,
// das Ergebnis je Raid mit Gründen, abgelaufene Auswahl und „Mehrere Charaktere …“
// an einem einzelnen Event.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/web/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/web/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/web/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/web/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/web/talkOverview", () => ({ SELECT_ID: "talk-signup", ALL_BUTTON_ID: "talk-signup-all", MULTI_BUTTON_ID: "talk-signup-multi" }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/web/raiderProfileStore");
const multi = require("../../../src/utils/multiSignup");
const all = require("../../../src/commands/signup/talkSignupAll");
const pickRaids = require("../../../src/commands/signup/talkSignupMulti");
const step = require("../../../src/commands/signup/signupMulti");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");

const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const DAY = 86400;
const sec = () => Math.floor(Date.now() / 1000);

beforeAll(() => profiles.useFile(tempStoreFile("eh-cmd-signup-multi.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.events.clear();
});

function characters() {
    profiles.addCharacter(ANNA, { name: "Zibbo", className: "Priest", specs: [{ key: "Priest-Holy", gear: "ready" }] });
    profiles.addCharacter(ANNA, { name: "Zibbowar", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }] });
}

/** `n` own raids, one per day from tomorrow; the titles are "Raid 1" … */
function raids(n, over = () => ({})) {
    for (let i = 1; i <= n; i++) {
        mocks.events.set(`eh-r${i}`, mocks.ownEvent({ id: `eh-r${i}`, title: `Raid ${i}`, startTime: sec() + i * DAY + 3600, signupDeadline: sec() + i * DAY, ...over(i) }));
    }
}

/** A submitted modal with the given select values per field. */
function modalSubmit(customId, values, { message = null, userId = ANNA } = {}) {
    const i = mockInteraction({ customId, userId, modal: true, message });
    i.fields.getStringSelectValues = jest.fn((id) => {
        if (!(id in values)) throw new Error("not in the submission");
        return values[id];
    });
    return i;
}

const tokenOf = (customId) => customId.split(":")[1];

describe("talk overview buttons (#293)", () => {
    it("are components of the overview select and inherit its access", () => {
        expect(all).toMatchObject({ name: "talk-signup-all", accessOf: "talk-signup" });
        expect(pickRaids).toMatchObject({ name: "talk-signup-multi", accessOf: "talk-signup" });
        expect(step).toMatchObject({ name: "signup-multi", accessOf: "talk-signup" });
    });

    it("„Für alle Raids“ opens one modal with one character select and the status for every raid", async () => {
        characters();
        raids(7);
        mocks.events.set("eh-begun", mocks.ownEvent({ id: "eh-begun", startTime: sec() - 60 }));
        const i = mockInteraction({ customId: "talk-signup-all", userId: ANNA });
        await all.execute(i);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.title).toBe("Sign up for all 7 raids");
        expect(modal.custom_id).toMatch(/^signup-multi:[a-f0-9]{8}:m:0$/);
        expect(modal.custom_id.length).toBeLessThanOrEqual(100);
        expect(modal.components.map((c) => [c.type, c.label, c.component.custom_id])).toEqual([
            [18, "Characters · specs for all raids", "all"],
            [18, "Status for all", "status"],
        ]);
        const select = modal.components[0].component;
        expect(select).toMatchObject({ type: 3, min_values: 1, max_values: 2 });
        expect(select.options.map((o) => [o.label, o.default])).toEqual([["Zibbo · Holy", true], ["Zibbowar · Protection", false]]);
        expect(modal.components[0].description).toContain("Topmost pick = 1st choice");
    });

    it("without characters or raids answers only the member, with where to go", async () => {
        raids(1);
        const none = mockInteraction({ customId: "talk-signup-all", userId: ANNA });
        await all.execute(none);
        expect(none.showModal).not.toHaveBeenCalled();
        expect(none.reply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.Ephemeral, content: expect.stringContaining("characters with a spec") });
        expect(none.reply.mock.calls[0][0].components[0].components[0].url).toBe("https://eh.example/profile");

        characters();
        mocks.events.clear();
        const empty = mockInteraction({ customId: "talk-signup-multi", userId: ANNA });
        await pickRaids.execute(empty);
        expect(empty.reply.mock.calls[0][0].content).toContain("no coming raids");
    });

    it("saves „alle“ per raid: first pick = choice, class and deadline refusals named per raid", async () => {
        characters();
        raids(3, (n) => (n === 3 ? { signupDeadline: sec() - 60 } : n === 2 ? { versionId: "andere-version" } : {}));
        const open = mockInteraction({ customId: "talk-signup-all", userId: ANNA });
        await all.execute(open);
        const id = open.showModal.mock.calls[0][0].custom_id;
        // the modal was opened from the public overview message: that message must never be edited
        const submit = modalSubmit(id, { all: ["zibbowar|Warrior-Protection", "zibbo|Priest-Holy"], status: ["signed"] }, { message: { id: "overview" } });
        await step.execute(submit);
        expect(submit.deferUpdate).not.toHaveBeenCalled();
        expect(submit.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const payload = submit.editReply.mock.calls[0][0];
        expect(payload.embeds[0].title).toBe("Signup: 1 of 3 raids saved");
        const lines = payload.embeds[0].description.split("\n");
        // the listed order decides: Zibbo was listed first, so Zibbo is the choice
        expect(lines[0]).toMatch(/^✅ \*\*Raid 1\*\* · <t:\d+:D>: Zibbo · Holy, \+Zibbowar · Protection$/);
        expect(lines[1]).toMatch(/^⛔ \*\*Raid 2\*\*.*None of the picked characters fits \(Zibbo · Holy skipped: class does not fit this raid; /);
        expect(lines[2]).toMatch(/^⛔ \*\*Raid 3\*\*.*signup deadline/);
        expect(mocks.signups.get(`eh-r1/${ANNA}`).characters.map((c) => c.character)).toEqual(["Zibbo", "Zibbowar"]);
        // done: the token is gone
        expect(multi.getSession(tokenOf(id), ANNA)).toBeNull();
    });
});

describe("Mehrere Raids wählen … (#293)", () => {
    async function startStep1() {
        characters();
        raids(7);
        const i = mockInteraction({ customId: "talk-signup-multi", userId: ANNA });
        await pickRaids.execute(i);
        const payload = i.reply.mock.calls[0][0];
        const token = tokenOf(payload.components[0].components[0].custom_id);
        return { payload, token };
    }

    it("shows step 1 only to the member: every raid preselected, status, Weiter", async () => {
        const { payload, token } = await startStep1();
        expect(payload.flags).toBe(MessageFlags.Ephemeral);
        expect(payload.embeds[0].title).toBe("Which raids?");
        const [raidRow, statusRow, goRow] = payload.components;
        expect(raidRow.components[0]).toMatchObject({ custom_id: `signup-multi:${token}:r`, min_values: 1, max_values: 7 });
        expect(raidRow.components[0].options.every((o) => o.default)).toBe(true);
        expect(statusRow.components[0].options.map((o) => o.label)).toEqual(["Sign up", "Tentative", "Late", "Bench", "Absence"]);
        expect(goRow.components[0]).toMatchObject({ custom_id: `signup-multi:${token}:go:0`, label: "Next: characters (Raids 1–5)" });
    });

    it("keeps the picked raids and status, then pages the modal in fives with Weiter", async () => {
        const { token } = await startStep1();
        const pickR = mockInteraction({ customId: `signup-multi:${token}:r`, userId: ANNA, values: ["eh-r1", "eh-r2", "eh-r3", "eh-r4", "eh-r5", "eh-r6"] });
        await step.execute(pickR);
        expect(pickR.update.mock.calls[0][0].components[0].components[0].options.filter((o) => o.default)).toHaveLength(6);
        await step.execute(mockInteraction({ customId: `signup-multi:${token}:s`, userId: ANNA, values: ["tentative"] }));

        const go = mockInteraction({ customId: `signup-multi:${token}:go:0`, userId: ANNA });
        await step.execute(go);
        const first = go.showModal.mock.calls[0][0];
        expect(first.title).toBe("Which characters? (1/2)");
        expect(first.components).toHaveLength(5);
        expect(first.components.map((c) => c.component.custom_id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
        expect(first.components[0].label).toMatch(/^Raid 1 · [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
        expect(first.components[0].component).toMatchObject({ min_values: 0, required: false });

        const message = { id: "step1" };
        const submit = modalSubmit(first.custom_id, { r0: ["zibbo|Priest-Holy"], r1: ["zibbowar|Warrior-Protection", "zibbo|Priest-Holy"], r3: [] }, { message });
        await step.execute(submit);
        expect(submit.deferUpdate).toHaveBeenCalled();
        const partial = submit.editReply.mock.calls[0][0];
        expect(partial.embeds[0].title).toBe("So far 2 of 5 raids saved");
        expect(partial.embeds[0].description).toContain("⏭️ **Raid 3**");
        expect(partial.embeds[0].description).toMatch(/✅ \*\*Raid 1\*\*.*Zibbo · Holy – Tentative/);
        expect(partial.components[0].components[0]).toMatchObject({ custom_id: `signup-multi:${token}:go:1`, label: "Next: Raid 6" });
        expect(mocks.signups.get(`eh-r2/${ANNA}`).characters.map((c) => c.character)).toEqual(["Zibbo", "Zibbowar"]);

        const go2 = mockInteraction({ customId: `signup-multi:${token}:go:1`, userId: ANNA, message });
        await step.execute(go2);
        const second = go2.showModal.mock.calls[0][0];
        expect(second.title).toBe("Which characters? (2/2)");
        expect(second.components.map((c) => c.label.split(" · ")[0])).toEqual(["Raid 6"]);
        const last = modalSubmit(second.custom_id, { r0: ["zibbowar|Warrior-Protection"] }, { message });
        await step.execute(last);
        const done = last.editReply.mock.calls[0][0];
        expect(done.embeds[0].title).toBe("Signup: 3 of 6 raids saved");
        expect(done.components[0].components.map((b) => b.label)).toEqual(["My signups"]);
        expect(mocks.signups.has(`eh-r7/${ANNA}`)).toBe(false);
    });

    it("refuses an expired or foreign token without saving anything", async () => {
        const { token } = await startStep1();
        const foreign = mockInteraction({ customId: `signup-multi:${token}:go:0`, userId: BERT });
        await step.execute(foreign);
        expect(foreign.showModal).not.toHaveBeenCalled();
        expect(foreign.update.mock.calls[0][0].content).toContain("expired");

        const later = Date.now() + multi.SESSION_TTL + 1000;
        expect(multi.getSession(token, ANNA, later)).toBeNull();
        const expired = modalSubmit("signup-multi:deadbeef:m:0", { r0: ["zibbo|Priest-Holy"] });
        await step.execute(expired);
        expect(expired.reply.mock.calls[0][0]).toMatchObject({ flags: MessageFlags.Ephemeral, content: expect.stringContaining("expired") });
        expect(mocks.signups.size).toBe(0);
    });
});

describe("Mehrere Charaktere … an einem Event (#293)", () => {
    it("opens the modal for that one raid with the current characters preselected in their order", async () => {
        characters();
        raids(1);
        mocks.signups.set(`eh-r1/${ANNA}`, {
            userId: ANNA, status: "signed", character: "Zibbowar", spec: "Warrior-Protection", role: "tank",
            characters: [{ character: "Zibbowar", spec: "Warrior-Protection", role: "tank" }, { character: "Zibbo", spec: "Priest-Holy", role: "healer" }],
        });
        const i = mockInteraction({ customId: "signup-multi:e:eh-r1:s", userId: ANNA });
        await step.execute(i);
        const modal = i.showModal.mock.calls[0][0];
        expect(modal.title).toBe("Which characters?");
        const select = modal.components[0].component;
        expect(select).toMatchObject({ min_values: 1, required: true });
        expect(select.options.map((o) => [o.value, o.default])).toEqual([["zibbowar|Warrior-Protection", true], ["zibbo|Priest-Holy", true]]);

        const submit = modalSubmit(modal.custom_id, { r0: ["zibbo|Priest-Holy", "zibbowar|Warrior-Protection"] }, { message: { id: "picker" } });
        await step.execute(submit);
        expect(mocks.signups.get(`eh-r1/${ANNA}`).characters.map((c) => c.character)).toEqual(["Zibbowar", "Zibbo"]);
    });

    it("refuses after the deadline for „Dabei“ and without the raider role", async () => {
        characters();
        raids(1, () => ({ signupDeadline: sec() - 60 }));
        const late = mockInteraction({ customId: "signup-multi:e:eh-r1:s", userId: ANNA });
        await step.execute(late);
        expect(late.reply.mock.calls[0][0].content).toContain("signup deadline");

        mocks.events.set("eh-r2", mocks.ownEvent({ id: "eh-r2", categoryId: "cat" }));
        mocks.access.config = { guildId: "g", categoryRoles: { cat: ["role"] } };
        mocks.access.roleIds = [];
        const noRole = mockInteraction({ customId: "signup-multi:e:eh-r2:s", userId: ANNA });
        await step.execute(noRole);
        expect(noRole.reply.mock.calls[0][0].content).toBe("You need a raider role for this raid.");
        expect(noRole.showModal).not.toHaveBeenCalled();
    });
});

describe("utils/multiSignup", () => {
    it("parses both customId forms and keeps them under 100 characters", () => {
        expect(multi.parseMultiId("signup-multi:0123abcd:go:2")).toMatchObject({ token: "0123abcd", action: "go", page: 2 });
        expect(multi.parseMultiId("signup-multi:e:eh-abc:l")).toMatchObject({ action: "one", eventId: "eh-abc", status: "late" });
        expect(multi.parseMultiId("signup-multi:nottoken:go:0").token).toBe("");
        expect(multi.oneEventId(`eh-${"x".repeat(20)}`, "signed").length).toBeLessThanOrEqual(100);
    });

    it("offers only raids that still take signups: not begun, not cancelled, not closed (#288)", () => {
        raids(4, (n) => (n === 2 ? { status: "cancelled" } : n === 3 ? { signupsClosed: true } : {}));
        mocks.events.set("eh-begun", mocks.ownEvent({ id: "eh-begun", startTime: sec() - 60 }));
        expect(multi.signableRaids().map((e) => e.id)).toEqual(["eh-r1", "eh-r4"]);
        mocks.access.config = { categoryIds: ["cat-x"] };
        expect(multi.signableRaids()).toEqual([]);
    });

    it("orders the picks as the modal listed them, not as Discord returns them", () => {
        const order = [{ value: "a|X" }, { value: "b|Y" }, { value: "c|Z" }];
        expect(multi.orderedPicks(["c|Z", "a|X", "nope|Q"], order)).toEqual([{ character: "a", spec: "X" }, { character: "c", spec: "Z" }]);
    });
});
