jest.mock("../../src/config/variables.js", () => ({ publicBaseUrl: "http://localhost:3005", embedAccentColor: 0x123456 }));

const { characterOwners, approvedPerPlayer, buildRaiderMessage, sendApproved, sendStatus, sentSignature } = require("../../src/web/recommendationSend.js");

/** A minimal EmbedBuilder stand-in that records what was set. */
function fakeEmbed() {
    const e = { fields: [] };
    for (const k of ["setTitle", "setDescription", "setURL", "setFooter", "setColor"]) e[k] = (v) => { e[k.slice(3).toLowerCase()] = v; return e; };
    e.addFields = (f) => { e.fields.push(f); return e; };
    return e;
}

function report(review) {
    return {
        id: "abc123", title: "Gruul", date: "10.9.2026, 20:05:00",
        roster: [{ name: "Farin", type: "Warlock" }, { name: "Dorn", type: "Shaman" }, { name: "Nomap", type: "Mage" }, { name: "Twice", type: "Rogue" }],
        recommendations: {
            raid: [],
            players: [
                { name: "Farin", type: "Warlock", items: [{ key: "gear", impact: "high", title: "Gear", text: "Gear fixen." }, { key: "food", impact: "low", title: "Essen", text: "Essen." }] },
                { name: "Dorn", type: "Shaman", items: [{ key: "totems.twisting", impact: "medium", title: "Twisting", text: "Twisten." }] },
                { name: "Nomap", type: "Mage", items: [{ key: "gear", impact: "high", title: "Gear", text: "…" }] },
                { name: "Twice", type: "Rogue", items: [{ key: "gear", impact: "high", title: "Gear", text: "…" }] },
            ],
        },
        recommendationReview: review || { raid: {}, players: {
            Farin: { gear: { approved: true, text: "Bitte vor dem Raid verzaubern." }, food: { approved: false } },
            Dorn: { "totems.twisting": { approved: true } },
            Nomap: { gear: { approved: true } },
            Twice: { gear: { approved: true } },
        } },
    };
}

const assignments = {
    cat1: { u1: "Farin", u2: "Dorn", u9: "Twice" },
    cat2: { u1: "farin", u8: "twice" },
};

describe("recommendationSend — helpers", () => {
    it("inverts the assignments case-insensitively and flags a character two accounts claim", () => {
        const owners = characterOwners(assignments);
        expect(owners.get("farin")).toEqual({ userId: "u1" });
        expect(owners.get("dorn")).toEqual({ userId: "u2" });
        expect(owners.get("twice")).toEqual({ ambiguous: ["u9", "u8"] });
        expect(owners.get("nomap")).toBeUndefined();
        expect(characterOwners(null).size).toBe(0);
    });

    it("lists only raiders with approved items, and only those items", () => {
        const list = approvedPerPlayer(report());
        expect(list.map((p) => p.name)).toEqual(["Farin", "Dorn", "Nomap", "Twice"]);
        expect(list[0].items.map((i) => i.key)).toEqual(["gear"]);
        expect(approvedPerPlayer({ recommendations: null })).toEqual([]);
    });

    it("builds the DM with a field per point, the lead's wording first, and the player page link", () => {
        const r = report();
        const p = approvedPerPlayer(r)[0];
        const msg = buildRaiderMessage(r, p, p.items, { embed: fakeEmbed });
        expect(msg.content).toBe("Deine Auswertung ist da: http://localhost:3005/r/abc123/p/0");
        const e = msg.embeds[0];
        expect(e.title).toBe("Deine Auswertung: Gruul");
        expect(e.url).toBe("http://localhost:3005/r/abc123/p/0");
        expect(e.description).toContain("Hallo Farin");
        expect(e.description).toContain("vom 10.9.2026");
        expect(e.fields).toEqual([{ name: "🔴 Gear", value: "Bitte vor dem Raid verzaubern." }]);
    });

    it("caps the DM at ten points and links the rest", () => {
        const r = report();
        const items = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, impact: "low", title: `T${i}`, text: "x" }));
        const msg = buildRaiderMessage(r, { name: "Farin" }, items, { embed: fakeEmbed });
        expect(msg.embeds[0].fields).toHaveLength(11);
        expect(msg.embeds[0].fields[10].value).toBe("und 2 weitere Punkte auf deiner Seite.");
    });

    it("changes the signature when the set or a rewritten text changes", () => {
        const a = sentSignature([{ key: "gear", custom: "" }, { key: "food", custom: "" }]);
        expect(sentSignature([{ key: "food", custom: "" }, { key: "gear", custom: "" }])).toBe(a);
        expect(sentSignature([{ key: "gear", custom: "neu" }, { key: "food", custom: "" }])).not.toBe(a);
        expect(sentSignature([{ key: "gear", custom: "" }])).not.toBe(a);
    });
});

describe("recommendationSend — sendApproved", () => {
    function discord(fail = []) {
        return {
            embed: fakeEmbed,
            sendDirectMessage: jest.fn(async (userId) => (fail.includes(userId) ? { ok: false, error: "Cannot send messages to this user" } : { ok: true, messageId: `m-${userId}` })),
        };
    }

    it("DMs every mapped raider with approved points, records it, and reports the rest with reasons", async () => {
        const d = discord();
        const r = report();
        const res = await sendApproved(r, { discord: d, assignments, by: "Lead" });
        expect(d.sendDirectMessage).toHaveBeenCalledTimes(2);
        expect(d.sendDirectMessage.mock.calls.map((c) => c[0])).toEqual(["u1", "u2"]);
        expect(res.sent).toEqual([{ name: "Farin", userId: "u1", items: 1 }, { name: "Dorn", userId: "u2", items: 1 }]);
        expect(res.skipped).toEqual([
            expect.objectContaining({ name: "Nomap", reason: "no_mapping" }),
            expect.objectContaining({ name: "Twice", reason: "ambiguous" }),
        ]);
        expect(r.recommendationSent.Farin).toEqual(expect.objectContaining({ by: "Lead", userId: "u1", keys: ["gear"], messageId: "m-u1" }));
        expect(r.recommendationSent.Nomap).toBeUndefined();
    });

    it("does not send an unchanged set twice, but does after a change or with force", async () => {
        const d = discord();
        const r = report();
        await sendApproved(r, { discord: d, assignments, by: "Lead" });
        const again = await sendApproved(r, { discord: d, assignments, by: "Lead" });
        expect(again.sent).toEqual([]);
        expect(again.skipped.filter((s) => s.reason === "already_sent").map((s) => s.name)).toEqual(["Farin", "Dorn"]);
        expect(d.sendDirectMessage).toHaveBeenCalledTimes(2);

        r.recommendationReview.players.Farin.food.approved = true;
        const changed = await sendApproved(r, { discord: d, assignments, by: "Lead" });
        expect(changed.sent.map((s) => s.name)).toEqual(["Farin"]);
        expect(r.recommendationSent.Farin.keys).toEqual(["gear", "food"]);

        const forced = await sendApproved(r, { discord: d, assignments, by: "Lead", force: true });
        expect(forced.sent.map((s) => s.name)).toEqual(["Farin", "Dorn"]);
    });

    it("restricts to the named raiders and reports a failed DM without recording it", async () => {
        const d = discord(["u2"]);
        const r = report();
        const res = await sendApproved(r, { discord: d, assignments, by: "Lead", only: ["Dorn"] });
        expect(d.sendDirectMessage).toHaveBeenCalledTimes(1);
        expect(res.sent).toEqual([]);
        expect(res.skipped).toEqual([expect.objectContaining({ name: "Dorn", reason: "dm_failed", message: "DM fehlgeschlagen: Cannot send messages to this user" })]);
        expect(r.recommendationSent.Dorn).toBeUndefined();
    });
});

describe("recommendationSend — sendStatus", () => {
    it("tells per raider whether they can be reached and whether the approved set moved since the last send", async () => {
        const r = report();
        await sendApproved(r, { discord: { embed: fakeEmbed, sendDirectMessage: async () => ({ ok: true }) }, assignments, by: "Lead" });
        r.recommendationReview.players.Farin.food.approved = true;
        const status = sendStatus(r, assignments);
        expect(status).toEqual([
            expect.objectContaining({ name: "Farin", approved: 2, mapped: true, ambiguous: false, changed: true }),
            expect.objectContaining({ name: "Dorn", approved: 1, mapped: true, changed: false }),
            expect.objectContaining({ name: "Nomap", approved: 1, mapped: false, sentAt: null }),
            expect.objectContaining({ name: "Twice", approved: 1, mapped: false, ambiguous: true }),
        ]);
        expect(status[0].sentAt).toBeGreaterThan(0);
    });
});
