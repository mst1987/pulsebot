// Shared pieces of the Kaderplaner suites (docs/kaderplaner.md): a small rule
// set, the mutation context the services expect, user ids and a helper that
// catches the AppError a refused change throws.
const { AppError } = require("../../src/web/http/apiResult");

const U = {
    lead: "100000000000000001",
    lead2: "100000000000000002",
    a: "111111111111111111",
    b: "222222222222222222",
    c: "333333333333333333",
    d: "444444444444444444",
    hand: "555555555555555555",
};

const spec = (key, role, extra = {}) => ({ key, role, canTank: role === "tank", canHeal: role === "healer", ...extra });

/** Five classes with their specs and roles, keyed like the rule set ("Warrior", "Warrior-Protection"). */
const CLASSES = [
    { key: "Warrior", name: "Krieger", color: "#C79C6E", canTank: true, canHeal: false, specs: [spec("Warrior-Protection", "tank"), spec("Warrior-Fury", "melee"), spec("Warrior-Arms", "melee")] },
    { key: "Mage", name: "Magier", color: "#69CCF0", canTank: false, canHeal: false, specs: [spec("Mage-Frost", "ranged"), spec("Mage-Fire", "ranged")] },
    { key: "Shaman", name: "Schamane", color: "#0070DE", canTank: false, canHeal: true, specs: [spec("Shaman-Restoration", "healer"), spec("Shaman-Enhancement", "melee"), spec("Shaman-Elemental", "ranged")] },
    { key: "Priest", name: "Priester", color: "#FFFFFF", canTank: false, canHeal: true, specs: [spec("Priest-Holy", "healer"), spec("Priest-Shadow", "ranged")] },
    { key: "Druid", name: "Druide", color: "#FF7D0A", canTank: true, canHeal: true, specs: [spec("Druid-Guardian", "tank", { canTank: true }), spec("Druid-Restoration", "healer"), spec("Druid-Balance", "ranged")] },
];

const NOW = "2026-10-02T18:00:00.000Z";

/** The context a mutator gets: rule set, acting user, time; `over` adds member ids, prefill, attendance. */
function kaderCtx(over = {}) {
    return {
        now: NOW,
        actor: U.lead,
        classes: new Map(CLASSES.map((c) => [c.key, c])),
        memberIds: new Set([U.a, U.b, U.c, U.d]),
        knownIds: new Set([U.a, U.b, U.c, U.d]),
        prefillOf: () => null,
        rateOf: () => 0,
        ...over,
    };
}

/** Runs `fn` and returns the AppError it threw. */
function refusal(fn) {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        return e;
    }
    throw new Error("expected a refusal");
}

module.exports = { U, CLASSES, NOW, kaderCtx, refusal };
