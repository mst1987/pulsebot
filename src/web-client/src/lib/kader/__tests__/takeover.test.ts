// The takeover assistant's logic: the start draft, what keeps a step, why the
// start is locked, the body sent, and who still waits for the role.
import { describe, expect, it } from "vitest";
import type { KaderTakeover } from "../../../api";
import { kader as kaderData, entry, U } from "../../../pages/kader/kader.fixture";
import {
    bodyOf, canStartDraft, categoryPreview, channelPreview, defaultDraft, draftProblems, emojiOk, MAX_TAKEOVER_CHANNELS, pendingOf, progressOf, ROSTER_NAME_MAX,
    startBlocker, stepProblems, takeoverErrorKey, withCheckRoster,
} from "../takeover";

const NAMES = { announce: "ankündigungen", chat: "chat" };
const OPEN = { blockers: [], canStart: true };
const taken = (results: KaderTakeover["results"]): KaderTakeover => ({
    rosterId: "r", roleId: "role", roleName: "Raider", categoryId: "cat", channelIds: [], by: "u1", at: "2026-10-20T18:00:00.000Z", status: "done", results,
});

describe("takeover draft", () => {
    it("starts with the Kader's name, a new category and an announcement channel only the orga writes in", () => {
        const d = defaultDraft("  Forever-Kader ", NAMES);
        expect(d).toMatchObject({ roleName: "Forever-Kader", categoryMode: "new", categoryName: "forever-kader", confirmed: false });
        expect(d.channels.map((c) => [c.name, c.orgaOnlyWrite])).toEqual([["ankündigungen", true], ["chat", false]]);
        expect(new Set(d.channels.map((c) => c.key)).size).toBe(2);
        expect(draftProblems(d)).toEqual([]);
    });

    it("names what keeps each step: role name, colour, icon; category, channel names and emojis, the limit", () => {
        const d = defaultDraft("K", NAMES);
        expect(stepProblems({ ...d, roleName: " ", roleColor: "#12", roleEmoji: ":x:" }, "role")).toEqual(["role_name", "role_color", "role_emoji"]);
        expect(stepProblems({ ...d, roleColor: "#3366CC", roleEmoji: "⚔️" }, "role")).toEqual([]);
        expect(stepProblems({ ...d, categoryName: "" }, "channels")).toEqual(["category"]);
        expect(stepProblems({ ...d, categoryMode: "existing" }, "channels")).toEqual(["category"]);
        expect(stepProblems({ ...d, categoryMode: "existing", categoryId: "c1", categoryEmoji: "abc" }, "channels")).toEqual([]);
        const many = Array.from({ length: MAX_TAKEOVER_CHANNELS + 1 }, (_, i) => ({ key: `k${i}`, name: `c${i}`, emoji: "", orgaOnlyWrite: false }));
        expect(stepProblems({ ...d, channels: many }, "channels")).toEqual(["too_many_channels"]);
        expect(stepProblems({ ...d, channels: [{ key: "a", name: "!!", emoji: "", orgaOnlyWrite: false }, { key: "b", name: "x", emoji: "<:x:1>", orgaOnlyWrite: false }] }, "channels")).toEqual(["channel_name", "channel_emoji"]);
        expect(stepProblems({ ...d, roleName: "" }, "who")).toEqual([]);
    });

    it("takes a short Unicode emoji, refuses text and custom emojis like the server", () => {
        expect(emojiOk("")).toBe(true);
        expect(emojiOk("🛡️")).toBe(true);
        expect(emojiOk("a")).toBe(false);
        expect(emojiOk("<:x:123>")).toBe(false);
        expect(emojiOk("🛡️".repeat(9))).toBe(false);
    });

    it("previews the names as Discord shows them", () => {
        expect(channelPreview({ name: "Ankündigungen Raid", emoji: "📢" })).toBe("📢・ankündigungen-raid");
        expect(channelPreview({ name: "Chat", emoji: "" })).toBe("chat");
        expect(categoryPreview({ ...defaultDraft("K", NAMES), categoryName: "Forever Kader", categoryEmoji: "⚔️" })).toBe("⚔️・Forever Kader");
    });
});

describe("takeover start", () => {
    it("is locked until the switch is on, and by every problem of the draft", () => {
        const d = defaultDraft("K", NAMES);
        expect(canStartDraft(d, OPEN)).toBe(false);
        expect(canStartDraft({ ...d, confirmed: true }, OPEN)).toBe(true);
        expect(canStartDraft({ ...d, confirmed: true, roleName: "" }, OPEN)).toBe(false);
        expect(canStartDraft({ ...d, confirmed: true }, { blockers: ["offline"], canStart: true })).toBe(false);
        expect(canStartDraft({ ...d, confirmed: true }, { blockers: [], canStart: false })).toBe(false);
    });

    it("gives the first reason: roster first, then nobody, own rights, what the bot lacks", () => {
        expect(startBlocker(OPEN)).toBeNull();
        expect(startBlocker({ blockers: ["offline", "no_roster"], canStart: false })).toBe("no_roster");
        expect(startBlocker({ blockers: ["no_players", "offline"], canStart: true })).toBe("no_players");
        expect(startBlocker({ blockers: ["offline"], canStart: false })).toBe("no_rights");
        expect(startBlocker({ blockers: ["no_manage_channels"], canStart: true })).toBe("no_manage_channels");
        expect(startBlocker({ blockers: ["already_taken"], canStart: true })).toBe("already_taken");
    });

    it("sends the role icon only where the server can show it, an existing category by id", () => {
        const d = { ...defaultDraft("K", NAMES), roleColor: "#3366CC", roleEmoji: "⚔️", categoryEmoji: "🛡️" };
        expect(bodyOf(d, 7, true)).toEqual({
            baseRev: 7,
            role: { name: "K", color: "#3366cc", unicodeEmoji: "⚔️" },
            category: { name: "k", emoji: "🛡️" },
            channels: [{ name: "ankündigungen", orgaOnlyWrite: true }, { name: "chat", orgaOnlyWrite: false }],
        });
        expect(bodyOf(d, 7, false).role).toEqual({ name: "K", color: "#3366cc" });
        expect(bodyOf({ ...d, roleColor: "", categoryMode: "existing", categoryId: "c9" }, 1, false)).toMatchObject({ role: { name: "K" }, category: { id: "c9" } });
    });

    it("sends a server emoji as emojiId, never together with a Unicode one", () => {
        const d = { ...defaultDraft("K", NAMES), roleEmojiId: "e1" };
        expect(defaultDraft("K", NAMES).roleEmojiId).toBe("");
        expect(bodyOf(d, 7, true).role).toEqual({ name: "K", emojiId: "e1" });
        expect(bodyOf({ ...d, roleEmoji: "⚔️" }, 7, true).role).toEqual({ name: "K", emojiId: "e1" });
        expect(bodyOf(d, 7, false).role).toEqual({ name: "K" });
    });

    it("says the known refusals in its own words, leaves the rest to the server", () => {
        expect(takeoverErrorKey("stale")).toBe("kader.takeover.error.stale");
        expect(takeoverErrorKey("role_too_high")).toBe("kader.takeover.error.role_too_high");
        expect(takeoverErrorKey("something_new")).toBeNull();
    });
});

describe("takeover without a linked roster", () => {
    it("starts with the roster the server proposes, cut to the roster limit, without a category", () => {
        expect(defaultDraft("K", NAMES).newRoster).toBeNull();
        expect(defaultDraft("K", NAMES, null).newRoster).toBeNull();
        expect(defaultDraft("K", NAMES, { name: " Forever " }).newRoster).toEqual({ name: "Forever", categoryId: "" });
        expect(defaultDraft("K", NAMES, { name: "x".repeat(ROSTER_NAME_MAX + 5) }).newRoster?.name).toHaveLength(ROSTER_NAME_MAX);
    });

    it("needs a roster name in the role step", () => {
        const d = defaultDraft("K", NAMES, { name: "K" });
        expect(stepProblems(d, "role")).toEqual([]);
        expect(stepProblems({ ...d, newRoster: { name: "  ", categoryId: "" } }, "role")).toEqual(["roster_name"]);
        expect(canStartDraft({ ...d, confirmed: true, newRoster: { name: "", categoryId: "" } }, { ...OPEN, createsRoster: true })).toBe(false);
        expect(canStartDraft({ ...d, confirmed: true }, { ...OPEN, createsRoster: true })).toBe(true);
    });

    it("sends the new roster only when one is created, no category as null", () => {
        const d = defaultDraft("K", NAMES, { name: "K" });
        expect(bodyOf(d, 1, false).roster).toEqual({ name: "K", categoryId: null });
        expect(bodyOf({ ...d, newRoster: { name: " Neu ", categoryId: "rc2" } }, 1, false).roster).toEqual({ name: "Neu", categoryId: "rc2" });
        expect("roster" in bodyOf(defaultDraft("K", NAMES), 1, false)).toBe(false);
    });

    it("locks for anyone but full admins, and on a hidden version", () => {
        expect(startBlocker({ blockers: [], canStart: false, createsRoster: true })).toBe("admin_only");
        expect(startBlocker({ blockers: [], canStart: false, createsRoster: false })).toBe("no_rights");
        expect(startBlocker({ blockers: ["no_players", "version_hidden"], canStart: true, createsRoster: true })).toBe("version_hidden");
        expect(startBlocker({ blockers: [], canStart: true, createsRoster: true })).toBeNull();
        for (const code of ["admin_only", "version_hidden", "category_taken", "invalid_roster_category", "invalid_name", "kader_taken", "roster_linked"]) {
            expect(takeoverErrorKey(code)).toBe(`kader.takeover.error.${code}`);
        }
    });

    it("follows a reloaded check: a roster linked meanwhile drops the new one, an unlinked one brings it", () => {
        const withNew = { ...defaultDraft("K", NAMES, { name: "Forever" }), roleName: "Raider" };
        const linked = withCheckRoster(withNew, { createsRoster: false, newRoster: null });
        expect(linked).toMatchObject({ newRoster: null, roleName: "Raider" });
        expect("roster" in bodyOf(linked, 1, false)).toBe(false);
        const unlinked = withCheckRoster(linked, { createsRoster: true, newRoster: { name: " Forever 2027 ", versionId: "forever" } });
        expect(unlinked.newRoster).toEqual({ name: "Forever 2027", categoryId: "" });
        // unchanged: the same draft, the typed name and category stay
        const typed = { ...unlinked, newRoster: { name: "Mein Name", categoryId: "rc2" } };
        expect(withCheckRoster(typed, { createsRoster: true, newRoster: { name: "Forever 2027", versionId: "forever" } })).toBe(typed);
        expect(withCheckRoster(linked, { createsRoster: false })).toBe(linked);
    });
});

describe("after the takeover", () => {
    it("waits for everybody from provisional upwards without the role, bench and tentative too", () => {
        const k = kaderData();
        expect(pendingOf(k)).toEqual([]);
        const t = taken({ [U.tank]: "ok", [U.sham]: "removed", [U.heal]: "missing" });
        expect(pendingOf({ ...k, takeover: t }).sort()).toEqual([U.heal, U.tent].sort());
    });

    it("counts the hand-out of the planned players", () => {
        const k = kaderData({ players: { ...kaderData().players, x: entry({ state: "roster" }) } });
        expect(progressOf(k, taken({ [U.tank]: "ok", [U.heal]: "missing", x: "failed" }))).toEqual({ given: 1, total: 5, missing: 1, failed: 1, open: 2 });
    });
});
