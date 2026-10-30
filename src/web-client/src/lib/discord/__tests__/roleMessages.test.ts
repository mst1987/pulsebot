// Rollen-Nachrichten, the editor's logic without React: which role is blocked
// and why, what is still wrong with the form, the server's error codes and
// reasons in words (both languages, every code the server can send), the
// colour field and the button rows of the preview.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RoleMessageInput, RoleMessageRoleOption } from "../../../api";
import { BACKEND_SRC } from "../../../test/backend";
import { inLang } from "../../../test/i18n";
import {
    ROLE_MESSAGE_LIMITS, buttonRows, colorToHex, emojiKey, groupChannels, problemText, reasonText, roleBlockReason,
    roleMessageErrorText, roleMessageProblems, toInput,
} from "../roleMessages";

const role = (over: Partial<RoleMessageRoleOption> = {}): RoleMessageRoleOption => ({
    id: "r1", name: "Kochen", color: "#e67e22", managed: false, privileged: "", editable: true, ...over,
});
const ROLES = [role(), role({ id: "r2", name: "Angeln", color: "" }), role({ id: "r9", name: "Orga", privileged: "the role is an orga role" })];

const input = (over: Partial<RoleMessageInput> = {}): RoleMessageInput => ({
    guildId: "", channelId: "c1", title: "Berufe", body: "", imageUrl: "", color: null,
    roles: [{ roleId: "r1", emoji: "", label: "" }],
    ...over,
});

const backendSource = (rel: string) => fs.readFileSync(path.join(BACKEND_SRC, rel), "utf8");

describe("roleBlockReason", () => {
    it("lets a plain role through and names why the others are blocked", () => {
        expect(roleBlockReason(role())).toBe("");
        expect(roleBlockReason(role({ privileged: "the role is an orga role" }))).toBe("Das ist eine Orga-Rolle.");
        expect(roleBlockReason(role({ managed: true }))).toBe("Die Rolle gehört zu einem Bot oder einer Integration.");
        expect(roleBlockReason(role({ editable: false }))).toBe("Die Rolle steht über der höchsten Rolle des Bots.");
    });

    it("puts the role's rights before the bot's reach", () => {
        expect(roleBlockReason(role({ privileged: "the role is a full-admin role", editable: false }))).toBe("Das ist eine Voll-Admin-Rolle.");
    });
});

describe("reasonText", () => {
    it("has words for every reason the server gives, in German and English", async () => {
        const src = backendSource("services/discord/selfRole.js");
        const reasons = [...src.matchAll(/(?:return|=>) "(the role [^"]+|missing Manage Roles)"/g)].map((m) => m[1]);
        expect(reasons.length).toBeGreaterThan(8);
        for (const r of reasons) expect(reasonText(r), r).not.toBe(r);
        const en = await inLang("en", () => reasons.map(reasonText));
        en.forEach((text, i) => expect(text, reasons[i]).not.toBe(reasons[i]));
    });

    it("names the roster of a roster role and keeps an unknown reason as written", () => {
        expect(reasonText("the role belongs to the roster Kader A")).toBe("Die Rolle gehört zum Roster „Kader A“ (Raider, Probe oder Manager).");
        expect(reasonText("the role unlocks the channel #gilde-intern")).toBe("Die Rolle schaltet den Kanal #gilde-intern frei.");
        expect(reasonText("something new")).toBe("something new");
    });
});

describe("roleMessageProblems", () => {
    it("finds nothing in a complete form", () => {
        expect(roleMessageProblems(input(), ROLES)).toEqual([]);
    });

    it("lists the missing and too long fields in the order they stand", () => {
        const codes = roleMessageProblems(input({
            channelId: "", title: "x".repeat(201), body: "y".repeat(3001), imageUrl: "http://bild.png", roles: [],
        }), ROLES).map((p) => p.code);
        expect(codes).toEqual(["missingChannel", "titleLong", "bodyLong", "badImage", "noRoles"]);
        expect(roleMessageProblems(input({ title: "  " }), ROLES).map((p) => p.code)).toEqual(["missingTitle"]);
    });

    it("refuses a blocked, an unknown and a doubled role", () => {
        const problems = roleMessageProblems(input({
            roles: [{ roleId: "r9", emoji: "", label: "" }, { roleId: "gone", emoji: "", label: "" }, { roleId: "r1", emoji: "", label: "" }, { roleId: "r1", emoji: "", label: "" }],
        }), ROLES);
        expect(problems).toEqual([
            { code: "blockedRole", roleId: "r9" },
            { code: "unknownRole", roleId: "gone" },
            { code: "duplicateRole", roleId: "r1" },
        ]);
    });

    it("does not judge the roles while the bot is offline (no role list)", () => {
        expect(roleMessageProblems(input({ roles: [{ roleId: "r9", emoji: "", label: "" }] }), [])).toEqual([]);
    });

    it("counts 25 buttons and 20 reactions as Discord does", () => {
        const many = Array.from({ length: 26 }, (_, i) => ({ roleId: `x${i}`, emoji: "", label: "" }));
        expect(roleMessageProblems(input({ roles: many }), []).map((p) => p.code)).toEqual(["tooManyRoles"]);
        const emojis = ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "😍", "😘", "🥰", "😗", "😙", "😚", "🙂", "🤗", "🤩"];
        const reacting = emojis.map((emoji, i) => ({ roleId: `x${i}`, emoji, label: "" }));
        expect(roleMessageProblems(input({ roles: reacting }), []).map((p) => p.code)).toEqual(["tooManyReactions"]);
        expect(roleMessageProblems(input({ roles: reacting.slice(0, 20) }), [])).toEqual([]);
    });

    it("finds the same emoji twice, with and without the variation selector, and a too long button text", () => {
        const problems = roleMessageProblems(input({
            roles: [
                { roleId: "r1", emoji: "❤️", label: "" },
                { roleId: "r2", emoji: "❤", label: "z".repeat(81) },
            ],
        }), ROLES);
        expect(problems).toEqual([{ code: "labelLong", roleId: "r2" }, { code: "duplicateEmoji", roleId: "r2" }]);
    });

    it("says each problem as a sentence with the role's name and the limit", () => {
        const name = (id: string) => (id === "r2" ? "Angeln" : "?");
        expect(problemText({ code: "labelLong", roleId: "r2" }, ROLE_MESSAGE_LIMITS, name)).toBe("Der Knopf-Text von @Angeln ist länger als 80 Zeichen.");
        expect(problemText({ code: "tooManyRoles" }, ROLE_MESSAGE_LIMITS, name)).toBe("Höchstens 25 Rollen je Nachricht.");
    });
});

describe("roleMessageErrorText", () => {
    const name = (id: string) => (id === "r9" ? "Orga" : id);

    it("has a sentence for every code the server sends, in German and English", async () => {
        const src = backendSource("services/discord/roleMessages.js") + backendSource("web/apiRoutes/roleMessages.js");
        const codes = [...new Set([...src.matchAll(/(?:fail\(|code:\s*)"([a-z_]+)"/g)].map((m) => m[1]))];
        expect(codes.length).toBeGreaterThan(15);
        for (const code of codes) {
            const de = roleMessageErrorText({ code, message: "RAW" }, name);
            expect(de, code).not.toBe("RAW");
            expect(de, code).not.toContain("roleMessages.");
        }
        const en = await inLang("en", () => codes.map((code) => roleMessageErrorText({ code, message: "RAW" }, name)));
        en.forEach((text, i) => {
            expect(text, codes[i]).not.toBe("RAW");
            expect(text, codes[i]).not.toContain("roleMessages.");
        });
    });

    it("names the role and the reason in the menu's language", async () => {
        const err = { code: "privileged_role", message: "Die Rolle @Orga ...", roleId: "r9", reason: "the role is an orga role" };
        expect(roleMessageErrorText(err, name)).toBe("@Orga trägt Rechte und darf nicht per Klick vergeben werden: Das ist eine Orga-Rolle.");
        const en = await inLang("en", () => roleMessageErrorText(err, name));
        expect(en).toContain("@Orga");
        expect(en).not.toContain("Orga-Rolle");
    });

    it("keeps the server's message for an unknown code", () => {
        expect(roleMessageErrorText({ code: "teapot", message: "Ich bin eine Teekanne" }, name)).toBe("Ich bin eine Teekanne");
    });
});

describe("helpers", () => {
    it("turns the stored colour into the colour field's value", () => {
        expect(colorToHex(null)).toBeNull();
        expect(colorToHex(undefined)).toBeNull();
        expect(colorToHex(0x8a7cff)).toBe("#8a7cff");
        expect(colorToHex(255)).toBe("#0000ff");
    });

    it("keys a server emoji by its id and a Unicode one without the variation selector", () => {
        expect(emojiKey("<:koch:123456789012345678>")).toBe("123456789012345678");
        expect(emojiKey("❤️")).toBe(emojiKey("❤"));
        expect(emojiKey("")).toBe("");
    });

    it("groups the channels by category, those without one first", () => {
        const ch = (id: string, category: string) => ({ id, name: id, category, parentId: category, canReact: true });
        const groups = groupChannels([ch("a", "Info"), ch("b", ""), ch("c", "Info"), ch("d", "Raids")]);
        expect(groups.map((g) => [g.category, g.channels.map((c) => c.id)])).toEqual([["", ["b"]], ["Info", ["a", "c"]], ["Raids", ["d"]]]);
    });

    it("lays the buttons out in rows of five", () => {
        expect(buttonRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).map((r) => r.length)).toEqual([5, 5, 2]);
        expect(buttonRows([])).toEqual([]);
    });

    it("trims the draft and gives an empty button text the role's name", () => {
        expect(toInput(input({ title: " Berufe ", roles: [{ roleId: "r1", emoji: " 🍳 ", label: " " }] }), ROLES)).toMatchObject({
            title: "Berufe", roles: [{ roleId: "r1", emoji: "🍳", label: "Kochen" }],
        });
    });
});
