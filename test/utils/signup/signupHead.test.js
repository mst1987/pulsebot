// The head of every ephemeral signup step ("Steckbrief", Nov 2026): raid name and date beside the picture, the facts below,
// a missing value drops out. And the rule that came with it: a Components V2 message cannot turn back into an embed, so every
// path that edits one of these messages (update, editReply) has to answer with a card again.
const { MessageFlags } = require("discord.js");

jest.mock("../../../src/stores/events/eventStore", () => require("../../helpers/signupMocks").eventStore());
jest.mock("../../../src/stores/events/signupStore", () => require("../../helpers/signupMocks").signupStore());
jest.mock("../../../src/stores/settings/settingsStore", () => require("../../helpers/signupMocks").settingsStore());
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/signupMocks").discord());
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 1, logcheckAdminIds: [], adminRoleIds: [] }));

const mocks = require("../../helpers/signupMocks");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const { signupWhen, signupPicture, signupFill, stepCard } = require("../../../src/utils/signup/signupHead");
const { buildCharacterPicker, buildClassPicker, buildSpecPicker, savedEmbed } = require("../../../src/utils/signup/signupButtons");
const { buildJoinPicker } = require("../../../src/utils/signup/joinPicker");
const { buildSignupDialog } = require("../../../src/utils/signup/signupDialog");
const { answerPayload, answerUpdate } = require("../../../src/utils/signup/signupReply");
const multi = require("../../../src/utils/signup/multiSignup");
const eventButton = require("../../../src/commands/signup/eventButton");
const eventJoin = require("../../../src/commands/signup/eventJoin");
const signupStatus = require("../../../src/commands/signup/signupStatus");
const signupPick = require("../../../src/commands/signup/signupPick");
const signupComment = require("../../../src/commands/signup/signupComment");
const signupMulti = require("../../../src/commands/signup/signupMulti");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { tempStoreFile } = require("../../helpers/tempStore");
const { nodes, cardText, cardColor } = require("../../helpers/cardText");
const { isCardPayload } = require("../../helpers/card");

const ANNA = "200000000000000001";
const NOBODY = "200000000000000009";
const ZONE = "https://render.worldofwarcraft.com/eu/zones/karazhan-small.jpg";
const OWN = "https://example.com/own-raid.png";
const sec = () => Math.floor(Date.now() / 1000);

const thumbnailOf = (payload) => {
    const thumb = nodes(payload).find((n) => n.type === 11);
    return thumb ? thumb.media.url : "";
};
const textBesidePicture = (payload) => {
    const section = nodes(payload).find((n) => n.type === 9);
    return section ? section.components.map((c) => c.content).join("\n") : "";
};
const setEvent = (over = {}) => mocks.events.set("eh-kara", mocks.ownEvent(over));
/** Two raids of 25 on one evening; the signups stay on the first (docs/setup.md "Raid-Gruppe"). */
const raidGroup = (over = {}) => {
    const group = { size: 25, guildId: "g1", raidGroupId: "eh-kara", ...over };
    mocks.events.set("eh-kara-2", mocks.ownEvent({ id: "eh-kara-2", raidGroupIndex: 2, ...group }));
    return setEvent({ raidGroupIndex: 1, ...group }).get("eh-kara");
};
const addSignups = (n, extra = {}) => {
    for (let i = 0; i < n; i += 1) {
        mocks.signups.set(`eh-kara/f${i}`, { userId: `f${i}`, character: `F${i}`, spec: "Mage-Fire", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1, ...extra });
    }
};
const twoCharacters = () => {
    profiles.addCharacter(ANNA, { name: "Nerathil", className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }] });
    profiles.addCharacter(ANNA, { name: "Brokk", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "usable" }, { key: "Warrior-Fury", gear: "none" }] });
};

/** The answer an update / editReply hands Discord for a message that already is a card: a card again, nothing else. */
function expectCard(payload) {
    expect(isCardPayload(payload)).toBe(true);
    expect(payload.content).toBe("");
    expect(payload.embeds).toEqual([]);
    expect(Number(payload.flags) & MessageFlags.IsComponentsV2).toBeTruthy();
}

/** The one answer of a click on a card: the update or editReply it edited the message with. */
function editOf(i) {
    const calls = [...i.update.mock.calls, ...i.editReply.mock.calls];
    expect(calls).toHaveLength(1);
    return calls[0][0];
}

beforeAll(() => profiles.useFile(tempStoreFile("eh-signup-head.json")));
afterAll(() => {
    profiles.reset();
    profiles.useFile(null);
});
beforeEach(() => {
    profiles.reset();
    mocks.reset();
    mocks.access.config = { guildId: "g1", botLanguage: "en", serverSettings: { g1: { botLanguage: "en" } } };
    setEvent();
});

describe("signupWhen", () => {
    it("gives the start as two Discord timestamps, nothing without a start", () => {
        expect(signupWhen({ startTime: 1800000000 })).toBe("<t:1800000000:f> <t:1800000000:R>");
        expect(signupWhen({ startTime: 0 })).toBe("");
        expect(signupWhen(null)).toBe("");
    });
});

describe("signupPicture", () => {
    it("takes the zone art of the raid", () => {
        expect(signupPicture(mocks.ownEvent())).toBe(ZONE);
    });

    it("prefers the event's own picture", () => {
        expect(signupPicture(mocks.ownEvent({ image: { url: OWN } }))).toBe(OWN);
    });

    it("drops the zone art when the category switched the raid picture off, the own picture stays", () => {
        mocks.access.config.categoryMessageLook = { cat: { raidArt: false } };
        expect(signupPicture(mocks.ownEvent({ categoryId: "cat" }))).toBe("");
        expect(signupPicture(mocks.ownEvent({ categoryId: "cat", image: { url: OWN } }))).toBe(OWN);
        // another category keeps its art
        expect(signupPicture(mocks.ownEvent({ categoryId: "other" }))).toBe(ZONE);
    });

    it("is empty without an event and for a raid without any art", () => {
        expect(signupPicture(null)).toBe("");
        expect(signupPicture(mocks.ownEvent({ title: "Stammtisch", instanceIds: [] }))).toBe("");
    });

    it("drops an address Discord would refuse, with the raid picture on and off", () => {
        const url = "https://x.y/a b.png";
        mocks.access.config.categoryMessageLook = { cat: { raidArt: false } };
        expect(signupPicture(mocks.ownEvent({ image: { url } }))).toBe("");
        expect(signupPicture(mocks.ownEvent({ categoryId: "cat", image: { url } }))).toBe("");
    });

    it("an address without https already falls back to the zone art (embedLook)", () => {
        expect(signupPicture(mocks.ownEvent({ image: { url: "http://x.y/a.png" } }))).toBe(ZONE);
    });
});

describe("signupFill", () => {
    it("counts accounts against the size of a raid with a real limit", () => {
        addSignups(3);
        for (const overflow of ["waitlist", "refuse"]) {
            expect(signupFill(mocks.ownEvent({ size: 10, overflow }), "en")).toBe("3 / 10 signed up");
            expect(signupFill(mocks.ownEvent({ size: 10, overflow }), "de")).toBe("3 / 10 angemeldet");
        }
    });

    it("without a real limit shows the count alone, without signups nothing", () => {
        expect(signupFill(mocks.ownEvent({ size: 10 }), "en")).toBe("");
        addSignups(3);
        expect(signupFill(mocks.ownEvent({ size: 10 }), "en")).toBe("3 signed up");
        expect(signupFill(mocks.ownEvent({ size: 10, overflow: "none" }), "de")).toBe("3 angemeldet");
        // a legacy value reads as no limit (#516)
        expect(signupFill(mocks.ownEvent({ size: 10, overflow: "bench" }), "en")).toBe("3 signed up");
    });

    it("without a size shows the count alone, whatever the mode", () => {
        expect(signupFill(mocks.ownEvent({ size: 0, overflow: "waitlist" }), "en")).toBe("");
        addSignups(2);
        expect(signupFill(mocks.ownEvent({ size: 0 }), "en")).toBe("2 signed up");
        expect(signupFill(mocks.ownEvent({ size: 0, overflow: "waitlist" }), "en")).toBe("2 signed up");
    });

    it("says full only with a real limit", () => {
        addSignups(2);
        expect(signupFill(mocks.ownEvent({ size: 2 }), "en")).toBe("2 signed up");
        expect(signupFill(mocks.ownEvent({ size: 2, overflow: "none" }), "en")).toBe("2 signed up");
        expect(signupFill(mocks.ownEvent({ size: 2, overflow: "waitlist" }), "en")).toBe("2 / 2 full");
        expect(signupFill(mocks.ownEvent({ size: 2, overflow: "refuse" }), "en")).toBe("2 / 2 full");
        expect(signupFill(mocks.ownEvent({ size: 2, overflow: "refuse" }), "de")).toBe("2 / 2 voll");
    });

    it("measures a raid group against all its places, as the service does", () => {
        const group = raidGroup({ overflow: "waitlist" });
        addSignups(30);
        expect(signupFill(group, "en")).toBe("30 / 50 signed up");
        mocks.signups.clear();
        addSignups(50);
        expect(signupFill(group, "en")).toBe("50 / 50 full");
    });
});

describe("stepCard", () => {
    it("sets name and date beside the picture and everything else below", () => {
        const event = mocks.ownEvent();
        const payload = stepCard(event, { lang: "en", lines: ["Which character?"] });
        expectCard(payload);
        expect(thumbnailOf(payload)).toBe(ZONE);
        expect(textBesidePicture(payload)).toContain("Karazhan");
        expect(textBesidePicture(payload)).toContain(signupWhen(event));
        expect(textBesidePicture(payload)).not.toContain("Which character?");
        expect(cardText(payload)).toContain("Which character?");
    });

    it("takes its edge from the event", () => {
        const { colorOf } = require("../../../src/utils/signup/signupReply");
        const event = mocks.ownEvent();
        expect(cardColor(stepCard(event, { lang: "en" }))).toBe(colorOf(event));
    });

    it("stays a plain card without a picture", () => {
        mocks.access.config.categoryMessageLook = { cat: { raidArt: false } };
        const payload = stepCard(mocks.ownEvent({ categoryId: "cat" }), { lang: "en", lines: ["Which character?"] });
        expectCard(payload);
        expect(thumbnailOf(payload)).toBe("");
        expect(cardText(payload)).toContain("Karazhan");
    });

    it("shows lead, fill and deadline where they exist", () => {
        const deadline = sec() + 3600;
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
        const event = mocks.ownEvent({ leaderId: ANNA, signupDeadline: deadline });
        const text = cardText(stepCard(event, { lang: "en", detail: true }));
        expect(text).toContain("Lead");
        expect(text).toContain("Nerathil");
        expect(text).toContain("1 signed up");
        expect(text).not.toContain("1 / 10");
        expect(text).toContain("Signup deadline");
        expect(text).toContain(`<t:${deadline}:f>`);
    });

    it("drops what is missing without a word", () => {
        const event = mocks.ownEvent({ leaderId: NOBODY, signupDeadline: 0, size: 0 });
        const text = cardText(stepCard(event, { lang: "en", detail: true }));
        expect(text).not.toContain("Lead");
        expect(text).not.toContain("Signup deadline");
        expect(text).not.toContain("signed up");
        expect(text).not.toMatch(/unknown|undefined|null|—/i);
    });

    it("drops a deadline that has passed", () => {
        const deadline = sec() - 60;
        const text = cardText(stepCard(mocks.ownEvent({ signupDeadline: deadline }), { lang: "en", detail: true }));
        expect(text).not.toContain("Signup deadline");
    });

    it("keeps the fill and the deadline out of the class and spec step", () => {
        const text = cardText(stepCard(mocks.ownEvent(), { lang: "en" }));
        expect(text).not.toContain("signed up");
        expect(text).not.toContain("Signup deadline");
    });

    it("says that new signups go to the waiting list only when they do", () => {
        const line = "The raid is full – new signups go to the waiting list.";
        addSignups(2);
        const of = (over) => cardText(stepCard(mocks.ownEvent({ size: 2, ...over }), { lang: "en", detail: true }));
        expect(of({ overflow: "waitlist" })).toContain(line);
        expect(of({ overflow: "none" })).not.toContain(line);
        expect(of({ overflow: "refuse" })).not.toContain(line);
        expect(of({ overflow: "waitlist", size: 3 })).not.toContain(line);
    });

    it("keeps quiet about the waiting list once nobody can sign up any more", () => {
        const line = "The raid is full – new signups go to the waiting list.";
        addSignups(2);
        const of = (over) => cardText(stepCard(mocks.ownEvent({ size: 2, overflow: "waitlist", ...over }), { lang: "en", detail: true }));
        expect(of({ signupsClosed: true })).not.toContain(line);
        expect(of({ startTime: sec() - 60 })).not.toContain(line);
        expect(of({ status: "cancelled" })).not.toContain(line);
        // past the deadline one can still sign up late, and that goes to the waiting list too
        expect(of({ signupDeadline: sec() - 60 })).toContain(line);
    });

    it("takes the moment it is built for, not the clock", () => {
        const line = "The raid is full – new signups go to the waiting list.";
        addSignups(2);
        const event = mocks.ownEvent({ size: 2, overflow: "waitlist" });
        const after = (Number(event.startTime) + 60) * 1000;
        expect(cardText(stepCard(event, { lang: "en", detail: true }))).toContain(line);
        expect(cardText(stepCard(event, { lang: "en", detail: true, now: after }))).not.toContain(line);
    });

    it("a raid group is not full at the size of one raid: no full mark, no waiting list", () => {
        const group = raidGroup({ overflow: "waitlist" });
        addSignups(30);
        const text = cardText(stepCard(group, { lang: "en", detail: true }));
        expect(text).toContain("30 / 50 signed up");
        expect(text).not.toContain("full");
        mocks.signups.clear();
        addSignups(50);
        expect(cardText(stepCard(group, { lang: "en", detail: true }))).toContain("The raid is full – new signups go to the waiting list.");
    });

    it("a picture Discord would refuse leaves the step without a thumbnail, not without an answer", () => {
        twoCharacters();
        const event = mocks.ownEvent({ image: { url: "https://x.y/a b.png" } });
        for (const payload of [
            stepCard(event, { lang: "en", lines: ["Which character?"] }),
            buildSignupDialog(event, ANNA, { lang: "en" }),
            buildJoinPicker(event, ANNA, "signed", { lang: "en" }),
        ]) {
            expectCard(payload);
            expect(nodes(payload).some((n) => n.type === 11)).toBe(false);
            expect(JSON.stringify(payload)).not.toContain("a b.png");
            expect(cardText(payload)).toContain("Karazhan");
        }
        const saved = savedEmbed(event, { userId: ANNA, status: "signed", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }] }, profiles.getProfile(ANNA), { lang: "en" });
        expect(saved.thumbnail).toBeUndefined();
    });

    it("translates the labels", () => {
        const deadline = sec() + 3600;
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
        const text = cardText(stepCard(mocks.ownEvent({ leaderId: ANNA, signupDeadline: deadline }), { lang: "de", detail: true }));
        expect(text).toContain("Leitung");
        expect(text).toContain("Anmeldeschluss");
    });

    it("never shows role counts", () => {
        addSignups(3);
        twoCharacters();
        const event = mocks.ownEvent();
        for (const payload of [
            buildSignupDialog(event, ANNA, { lang: "en" }),
            buildJoinPicker(event, ANNA, "signed", { lang: "en" }),
            buildCharacterPicker(event, ANNA, "signed", { lang: "en" }),
        ]) expect(cardText(payload)).not.toMatch(/Tanks?\s+\d|Heal\w*\s+\d|DPS\s+\d/);
    });
});

describe("what a step says below the head", () => {
    it("names a cancelled raid, with the reason when there is one", () => {
        const withReason = buildSignupDialog(mocks.ownEvent({ status: "cancelled", cancel: { reason: "Too few" } }), ANNA, { lang: "en" });
        expect(cardText(withReason)).toContain("The event was cancelled – Too few.");
        const without = buildSignupDialog(mocks.ownEvent({ status: "cancelled" }), ANNA, { lang: "en" });
        expect(cardText(without)).toContain("The event was cancelled.");
    });

    it("names the wished partners who are signed up", () => {
        const BERT = "200000000000000002";
        twoCharacters();
        profiles.saveProfile(ANNA, { wishes: [BERT] }, { name: "Anna" });
        mocks.signups.set(`eh-kara/${BERT}`, { userId: BERT, character: "Bertil", spec: "Mage-Fire", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
        expect(cardText(buildSignupDialog(mocks.ownEvent(), ANNA, { lang: "en" }))).toContain("Also signed up: Bertil");
    });

    it("marks the character of a spec imported from Raid-Helper as last used, by the spec alone (#291)", () => {
        twoCharacters();
        mocks.importedSpecs.set(ANNA, { character: "Elsewhere", spec: "Warrior-Protection" });
        const payload = buildJoinPicker(mocks.ownEvent(), ANNA, "signed", { lang: "en" });
        const select = nodes(payload).find((n) => n.options);
        const marked = select.options.filter((o) => String(o.description).includes("last used"));
        expect(marked.map((o) => o.label)).toEqual(["Brokk · Protection"]);
    });

    it("marks nothing as last used when the imported spec is not on any character", () => {
        twoCharacters();
        mocks.importedSpecs.set(ANNA, { character: "Elsewhere", spec: "Priest-Shadow" });
        const select = nodes(buildJoinPicker(mocks.ownEvent(), ANNA, "signed", { lang: "en" })).find((n) => n.options);
        expect(select.options.some((o) => String(o.description).includes("last used"))).toBe(false);
    });
});

describe("every step is such a card", () => {
    beforeEach(twoCharacters);

    it.each([
        ["the dialog", (e) => buildSignupDialog(e, ANNA, { lang: "en" })],
        ["the join picker", (e) => buildJoinPicker(e, ANNA, "signed", { lang: "en" })],
        ["the character picker", (e) => buildCharacterPicker(e, ANNA, "signed", { lang: "en" })],
        ["the class picker", (e) => buildClassPicker(e, "signed", { lang: "en" })],
        ["the spec picker", (e) => buildSpecPicker(e, "signed", "Priest", { lang: "en" })],
    ])("%s, with and without the zone art", (_name, build) => {
        const payload = build(mocks.ownEvent());
        expectCard(payload);
        expect(thumbnailOf(payload)).toBe(ZONE);
        expect(textBesidePicture(payload)).toContain("Karazhan");

        mocks.access.config.categoryMessageLook = { cat: { raidArt: false } };
        const without = build(mocks.ownEvent({ categoryId: "cat" }));
        expectCard(without);
        expect(thumbnailOf(without)).toBe("");

        const own = build(mocks.ownEvent({ categoryId: "cat", image: { url: OWN } }));
        expect(thumbnailOf(own)).toBe(OWN);
    });

    it("the confirmation carries the same head, without its old icons", () => {
        const event = mocks.ownEvent();
        const signup = { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }], canAlso: [], comment: "" };
        const payload = answerPayload(savedEmbed(event, signup, profiles.getProfile(ANNA), { lang: "en" }));
        expectCard(payload);
        expect(thumbnailOf(payload)).toBe(ZONE);
        const text = cardText(payload);
        expect(text).toContain("Saved for Karazhan");
        expect(text).not.toMatch(/🗓️|⏳/u);
    });

    it("keeps to the 40 components at the largest step", () => {
        for (let i = 0; i < 12; i += 1) {
            profiles.addCharacter(ANNA, { name: `Char${"abcdefghijkl"[i]}`, className: "Mage", specs: [{ key: "Mage-Arcane", gear: "ready" }, { key: "Mage-Fire", gear: "ready" }, { key: "Mage-Frost", gear: "ready" }] });
        }
        addSignups(30);
        mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }], canAlso: ["healer"], comment: "x".repeat(200), at: 1 });
        const event = mocks.ownEvent({ leaderId: ANNA, size: 10, overflow: "waitlist", image: { url: OWN } });
        for (const payload of [
            buildSignupDialog(event, ANNA, { lang: "en", notice: "A notice." }),
            buildJoinPicker(event, ANNA, "late", { lang: "en", notice: "A notice." }),
            buildCharacterPicker(event, ANNA, "late", { lang: "en", notice: "A notice." }),
            buildClassPicker(event, "signed", { lang: "en", notice: "A notice." }),
            buildSpecPicker(event, "signed", "Priest", { lang: "en" }),
        ]) {
            expect(nodes(payload).length).toBeLessThanOrEqual(40);
            expect(cardText(payload).length).toBeLessThanOrEqual(4000);
        }
    });
});

// The ways on from a card. Each answers by editing the card, so each has to be a card itself.
describe("nothing turns a card back into an embed", () => {
    const pickValue = "brokk|Warrior-Protection";

    describe("the steps under the event's buttons", () => {
        beforeEach(twoCharacters);
        const step = (action, extra = {}) => mockInteraction({ customId: `event-btn:eh-kara:${action}`, userId: ANNA, ...extra });

        it.each([
            ["a picked character", "pick:s", { values: [pickValue] }],
            ["nothing picked", "pick:s", { values: [] }],
            ["another class", "other:s", {}],
            ["a class", "cls:s", { values: ["Priest"] }],
            ["an unknown class", "cls:s", { values: ["Nonsense"] }],
            ["an unknown spec", "spec:s", { values: ["Nonsense-Spec"] }],
            ["an unknown action", "nonsense:s", {}],
        ])("%s", async (_name, action, extra) => {
            const i = step(action, extra);
            i.component = { options: [] };
            await eventButton.execute(i);
            expect(i.reply).not.toHaveBeenCalled();
            expectCard(editOf(i));
        });

        it("a refused save stays a card", async () => {
            setEvent({ signupDeadline: sec() - 60 });
            const i = step("pick:s", { values: [pickValue] });
            i.component = { options: [] };
            await eventButton.execute(i);
            expectCard(editOf(i));
        });

        it("signing off stays a card", async () => {
            mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [{ character: "Nerathil", spec: "Mage-Arcane", status: "signed" }], canAlso: [], comment: "" });
            const i = mockInteraction({ customId: "signup-status:eh-kara:a:::", userId: ANNA });
            await signupStatus.execute(i);
            expectCard(editOf(i));
        });

        it.each([
            ["is gone", () => mocks.events.delete("eh-kara")],
            ["is archived", () => setEvent({ archived: true })],
        ])("a step on an event that %s", async (_name, change) => {
            change();
            const i = step("cls:s", { values: ["Priest"] });
            await eventButton.execute(i);
            expectCard(editOf(i));
        });
    });

    describe("the name window behind a spec", () => {
        const submit = (name, spec = "Priest-Holy") => mockInteraction({ customId: `event-btn:eh-kara:name:s:${spec}`, userId: NOBODY, modal: true, options: { character: name } });
        const editedCard = (i) => {
            // the window was opened from a card, so the answer edits that card
            i.isFromMessage = () => true;
            i.message = { id: "card" };
            return i;
        };

        it("a saved name", async () => {
            const i = editedCard(submit("Ysolde"));
            await eventButton.execute(i);
            expectCard(editOf(i));
            expect(mocks.signups.get(`eh-kara/${NOBODY}`)).toMatchObject({ character: "Ysolde" });
        });

        it("a name that is taken by another class", async () => {
            profiles.addCharacter(NOBODY, { name: "Ysolde", className: "Mage", specs: [{ key: "Mage-Fire", gear: "ready" }] });
            const i = editedCard(submit("Ysolde"));
            await eventButton.execute(i);
            expectCard(editOf(i));
        });

        it("an unknown spec", async () => {
            const i = editedCard(submit("Ysolde", "Nonsense-Spec"));
            await eventButton.execute(i);
            expectCard(editOf(i));
        });

        it("an unusable name", async () => {
            const i = editedCard(submit("x"));
            await eventButton.execute(i);
            expectCard(editOf(i));
        });
    });

    describe("the second way in, under the event's select", () => {
        beforeEach(twoCharacters);

        it("another character", async () => {
            const i = mockInteraction({ customId: "event-join:eh-kara:s:c:nerathil:Mage-Arcane:", userId: ANNA, values: [pickValue] });
            await eventJoin.execute(i);
            expectCard(editOf(i));
        });

        it("the also-select", async () => {
            const i = mockInteraction({ customId: "event-join:eh-kara:s:m:brokk:Warrior-Protection:h", userId: ANNA });
            await eventJoin.execute(i);
            expectCard(editOf(i));
        });

        it("an event that is gone", async () => {
            const i = mockInteraction({ customId: "event-join:eh-gone:s:c:::", userId: ANNA, values: ["x|y"] });
            await eventJoin.execute(i);
            expectCard(editOf(i));
        });

        it("the first answer already is a card, ephemeral", async () => {
            const i = mockInteraction({ customId: "event-join:eh-kara", userId: ANNA, values: ["signed"] });
            await eventJoin.execute(i);
            const payload = i.reply.mock.calls[0][0];
            expectCard(payload);
            expect(Number(payload.flags) & MessageFlags.Ephemeral).toBeTruthy();
        });
    });

    describe("the dialog's own controls", () => {
        beforeEach(twoCharacters);

        it.each([
            ["signed up", "s"], ["late", "l"], ["tentative", "t"], ["bench", "b"], ["absent", "a"],
        ])("the status %s", async (_name, code) => {
            const i = mockInteraction({ customId: `signup-status:eh-kara:${code}:nerathil:Mage-Arcane:`, userId: ANNA });
            await signupStatus.execute(i);
            expectCard(editOf(i));
        });

        it("a refused status", async () => {
            setEvent({ signupDeadline: sec() - 60 });
            const i = mockInteraction({ customId: "signup-status:eh-kara:s:nerathil:Mage-Arcane:", userId: ANNA });
            await signupStatus.execute(i);
            expectCard(editOf(i));
        });

        it("a status on an event that is gone", async () => {
            const i = mockInteraction({ customId: "signup-status:eh-gone:s:::", userId: ANNA });
            await signupStatus.execute(i);
            expectCard(editOf(i));
        });

        it("another pick", async () => {
            const i = mockInteraction({ customId: "signup-pick:eh-kara:s:nerathil:Mage-Arcane:", values: [pickValue], userId: ANNA });
            await signupPick.execute(i);
            expectCard(editOf(i));
        });

        it("a saved comment", async () => {
            mocks.signups.set(`eh-kara/${ANNA}`, { userId: ANNA, character: "Nerathil", spec: "Mage-Arcane", role: "ranged", status: "signed", characters: [], canAlso: [], comment: "", at: 1 });
            const i = mockInteraction({ customId: "signup-comment:eh-kara:s:nerathil:Mage-Arcane:", userId: ANNA, modal: true, options: { comment: "Pizza" } });
            await signupComment.execute(i);
            expectCard(editOf(i));
        });
    });

    describe("several characters on one raid", () => {
        function shownSession(eventIds) {
            const token = multi.createSession(ANNA, { mode: "multi", eventIds });
            const session = multi.getSession(token, ANNA);
            session.selected = [...eventIds];
            multi.buildCharacterModal(token, session, 0, eventIds.map((id) => mocks.events.get(id)), profiles.getProfile(ANNA), { lang: "en" });
            return token;
        }
        const modalSubmit = (customId, values) => {
            const i = mockInteraction({ customId, userId: ANNA, modal: true, message: { id: "card" } });
            i.fields.getStringSelectValues = jest.fn((id) => {
                if (!(id in values)) throw new Error("not in the submission");
                return values[id];
            });
            return i;
        };

        it("the result replaces the card with a card", async () => {
            twoCharacters();
            const token = shownSession(["eh-kara"]);
            const i = modalSubmit(`signup-multi:${token}:m:0`, { r0: ["nerathil|Mage-Arcane"] });
            await signupMulti.execute(i);
            expectCard(i.editReply.mock.calls.at(-1)[0]);
        });

        it("a window on a choice that has run out answers apart from the card", async () => {
            const i = modalSubmit("signup-multi:deadbeef:m:0", {});
            await signupMulti.execute(i);
            expect(i.update).not.toHaveBeenCalled();
            expect(i.editReply).not.toHaveBeenCalled();
            expectCard(i.reply.mock.calls[0][0]);
        });

        it("the next page of a choice that has run out stays a card", async () => {
            const i = mockInteraction({ customId: "signup-multi:deadbeef:go:1", userId: ANNA });
            await signupMulti.execute(i);
            expectCard(editOf(i));
        });
    });

    it("the plain answers of the shared helper are cards, whatever they carry", () => {
        expectCard(answerUpdate("Just a line."));
        expectCard(answerUpdate({ title: "A title", description: "A line." }));
        expectCard(answerPayload("Just a line."));
    });
});
