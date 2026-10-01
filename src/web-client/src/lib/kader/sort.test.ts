import { describe, expect, it } from "vitest";
import type { KaderEntry, KaderMember } from "../../api";
import { CAT, kader, kaderView, QUESTIONS, U } from "../../pages/kader/kader.fixture";
import { switchLang } from "../../test/i18n";
import { byId, playerName } from "./model";
import {
    answerParts, IMPORT_SORT, importParts, overviewParts, overviewSortDefaults, pickParts, POOL_SORT, poolParts, sortByParts, sortTable, wishParts,
    type PoolSortKey,
} from "./sort";

const view = kaderView();
type Row = { userId: string; entry: KaderEntry };

function table(k = kader(), states?: string[]) {
    const rows: Row[] = Object.entries(k.players)
        .filter(([, e]) => !states || states.includes(e.state))
        .map(([userId, entry]) => ({ userId, entry }));
    return { k, rows, ctx: { view, kader: k, players: byId(view.players) } };
}
const nameOf = (r: Row) => playerName(view, r.userId, r.entry);

describe("lib/kader/sort · sortByParts", () => {
    it("compares numbers as numbers and text in the menu language's alphabet", () => {
        const words = ["Zora", "Ärger", "Anton", "item 10", "item 9"];
        expect(sortByParts(words, (w) => [w], "asc")).toEqual(["Anton", "Ärger", "item 9", "item 10", "Zora"]);
        expect(sortByParts(words, (w) => [w], "desc")).toEqual(["Zora", "item 10", "item 9", "Ärger", "Anton"]);
    });

    it("puts a row without a value last in both directions and keeps ties in their order", () => {
        const items = [{ n: "a", v: 2 }, { n: "b", v: null }, { n: "c", v: 1 }, { n: "d", v: 2 }];
        const parts = (x: { v: number | null }) => (x.v === null ? null : [x.v]);
        expect(sortByParts(items, parts, "asc").map((x) => x.n)).toEqual(["c", "a", "d", "b"]);
        expect(sortByParts(items, parts, "desc").map((x) => x.n)).toEqual(["a", "d", "c", "b"]);
        // the input stays as it was
        expect(items.map((x) => x.n)).toEqual(["a", "b", "c", "d"]);
    });

    it("compares the parts one after the other, a shorter list first", () => {
        const items: (string | number)[][] = [[1, "b"], [1, "a"], [0, "z"], [1]];
        expect(sortByParts(items, (x) => x, "asc")).toEqual([[0, "z"], [1], [1, "a"], [1, "b"]]);
    });

    it("breaks a tie by name: sortTable sorts by name first", () => {
        const items = [{ n: "Kurt", v: 1 }, { n: "Anna", v: 1 }, { n: "Bea", v: 0 }];
        expect(sortTable(items, (x) => x.n, (x) => [x.v], "desc").map((x) => x.n)).toEqual(["Anna", "Kurt", "Bea"]);
    });
});

describe("lib/kader/sort · Pool", () => {
    const { rows, ctx } = table();
    const sorted = (key: PoolSortKey, dir: "asc" | "desc" = POOL_SORT[key]) => sortTable(rows, nameOf, poolParts(ctx, key), dir).map(nameOf);

    it("starts every column in the direction a first click wants", () => {
        expect(POOL_SORT).toEqual({ name: "asc", char: "asc", roles: "desc", attendance: "desc", state: "desc" });
    });

    it("sorts by name", () => {
        expect(sorted("name")).toEqual(["Aldric", "Brakk", "Kael", "Liss", "Mira", "Neuling", "Tomas"]);
    });

    it("sorts by attendance over the Kader's categories, \"—\" last either way", () => {
        // Mira 100, Aldric 76, Liss 40 (only Do counts), the rest has no value
        expect(sorted("attendance", "desc")).toEqual(["Mira", "Aldric", "Liss", "Brakk", "Kael", "Neuling", "Tomas"]);
        expect(sorted("attendance", "asc")).toEqual(["Liss", "Aldric", "Mira", "Brakk", "Kael", "Neuling", "Tomas"]);
        // another pick, another order: with only the PUG category Liss leads
        const pug = table(kader({ attendanceCategories: [CAT.pug] }));
        expect(sortTable(pug.rows, nameOf, poolParts(pug.ctx, "attendance"), "desc").map(nameOf).slice(0, 2)).toEqual(["Liss", "Aldric"]);
    });

    it("sorts by the prefilled character: class, then spec, nothing last", () => {
        expect(sorted("char", "asc")).toEqual(["Brakk", "Aldric", "Liss", "Tomas", "Mira", "Kael", "Neuling"]);
        expect(sorted("char", "desc")).toEqual(["Mira", "Tomas", "Liss", "Aldric", "Brakk", "Kael", "Neuling"]);
    });

    it("sorts by state and by the number of Discord roles", () => {
        expect(sorted("state", "asc")).toEqual(["Neuling", "Brakk", "Liss", "Mira", "Aldric", "Tomas", "Kael"]);
        expect(sorted("roles", "desc")).toEqual(["Liss", "Aldric", "Mira", "Brakk", "Kael", "Neuling", "Tomas"]);
    });
});

describe("lib/kader/sort · Übersicht", () => {
    const { rows, ctx } = table(kader(), ["selected"]);
    const sorted = (key: string, dir: "asc" | "desc") => sortTable(rows, nameOf, overviewParts(ctx, key), dir).map(nameOf);

    it("has a column per question; a multiple choice starts with the most picks", () => {
        expect(overviewSortDefaults(QUESTIONS)).toEqual({ name: "asc", wish1: "asc", wish2: "asc", interview: "asc", since: "desc", "q-q1": "desc", "q-q2": "asc", "q-q3": "asc" });
    });

    it("sorts a wish by role order (tank, healer, melee, ranged), then class", () => {
        // Brakk wants Fury (melee), Liss Frost (ranged)
        expect(sorted("wish1", "asc")).toEqual(["Brakk", "Liss"]);
        expect(sorted("wish1", "desc")).toEqual(["Liss", "Brakk"]);
        // a missing second wish is last either way
        expect(sorted("wish2", "asc")).toEqual(["Brakk", "Liss"]);
        expect(sorted("wish2", "desc")).toEqual(["Brakk", "Liss"]);
    });

    it("sorts by interview status, by each question and by days waiting", () => {
        expect(sorted("interview", "asc")).toEqual(["Liss", "Brakk"]);
        // the voice question: Liss "Immer" (first option), Brakk "Meistens"
        expect(sorted("q-q2", "desc")).toEqual(["Brakk", "Liss"]);
        // raid days: Liss has not answered, last either way
        expect(sorted("q-q1", "asc")).toEqual(["Brakk", "Liss"]);
        expect(sorted("q-q1", "desc")).toEqual(["Brakk", "Liss"]);
        // both since the same day: by name
        expect(sorted("since", "desc")).toEqual(["Brakk", "Liss"]);
        // a question that is gone sorts nothing
        expect(sorted("q-gone", "asc")).toEqual(["Brakk", "Liss"]);
    });

    it("ranks answers: options in order, several by how many, text alphabetically, unanswered null", () => {
        const [days, voice, note] = QUESTIONS;
        expect(answerParts(voice, "o3")).toEqual([2]);
        expect(answerParts(days, ["d4", "d1"])).toEqual([2, 0, 3]);
        expect(answerParts(note, "  später  ")).toEqual(["später"]);
        expect(answerParts(note, "  ")).toBeNull();
        expect(answerParts(days, [])).toBeNull();
        expect(answerParts(voice, undefined)).toBeNull();
    });

    it("names classes in the menu language", async () => {
        expect(wishParts(view.classes, { className: "Mage", spec: "Mage-Frost" })).toEqual([3, "Magier", "Frost"]);
        await switchLang("en");
        try {
            expect(pickParts(view.classes, { className: "Warrior", spec: "Warrior-Fury" })).toEqual(["Warrior", "Fury"]);
        } finally {
            await switchLang("de");
        }
        expect(pickParts(view.classes, null)).toBeNull();
        expect(wishParts(view.classes, undefined)).toBeNull();
    });
});

describe("lib/kader/sort · import", () => {
    const k = kader();
    const inKader = (m: KaderMember) => !!k.players[m.userId];
    const sorted = (key: keyof typeof IMPORT_SORT, dir: "asc" | "desc") => sortTable(view.members, (m) => m.displayName, importParts(view, key, inKader), dir).map((m) => m.displayName);

    it("sorts the members by name, prefilled character and source, missing data last", () => {
        expect(sorted("name", "asc")).toEqual(["Aldric", "Gast", "Ohne"]);
        expect(sorted("prefill", "asc")).toEqual(["Aldric", "Gast", "Ohne"]);
        expect(sorted("prefill", "desc")).toEqual(["Gast", "Aldric", "Ohne"]);
        // profile before "already in the Kader", nothing known last
        expect(sorted("source", "asc")).toEqual(["Gast", "Aldric", "Ohne"]);
        expect(sorted("source", "desc")).toEqual(["Aldric", "Gast", "Ohne"]);
    });

    it("knows which player the ids stand for", () => {
        expect(view.members.map((m) => m.userId)).toEqual([U.tank, U.guest, U.lead2]);
    });
});
