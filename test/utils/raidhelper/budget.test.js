// The request budget for raid-helper.xyz (#606): 1000 requests per key and
// day, the bot stops itself before — background first, writes last.
const { tempStoreFile } = require("../../helpers/tempStore");
const budgetStore = require("../../../src/stores/raidhelperBudgetStore");
const budget = require("../../../src/utils/raidhelper/budget");
const { RAIDHELPER_BUDGET } = require("../../../src/config/constants");

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const PROD = { NODE_ENV: "production" };
const DEV = { NODE_ENV: "development" };

const hourOf = (ms) => String(Math.floor(ms / HOUR));
const fill = (hours) => budgetStore.writeBudget({ hours });

beforeEach(() => budgetStore.useFile(tempStoreFile("raidhelper-budget.json")));
afterAll(() => budgetStore.useFile(null));

describe("utils/raidhelper/budget", () => {
    describe("priorities", () => {
        it("calls anything but GET a write, a GET a read outside a job", () => {
            expect(budget.priorityFor("post")).toBe("write");
            expect(budget.priorityFor("GET")).toBe("read");
            expect(budget.priorityFor()).toBe("read");
        });

        it("calls a GET inside runInBackground background, also in its timers and promises", async () => {
            expect(budget.isBackground()).toBe(false);
            const seen = await budget.runInBackground(async () => {
                await Promise.resolve();
                const inTimer = await new Promise((resolve) => setTimeout(() => resolve(budget.priorityFor("get")), 0));
                return [budget.priorityFor("get"), inTimer, budget.priorityFor("post")];
            });
            expect(seen).toEqual(["background", "background", "write"]);
            expect(budget.isBackground()).toBe(false);
        });

        it("gives production the configured caps, background lowest, writes highest", () => {
            expect(budget.capFor("background", PROD)).toBe(RAIDHELPER_BUDGET.background);
            expect(budget.capFor("read", PROD)).toBe(RAIDHELPER_BUDGET.read);
            expect(budget.capFor("write", PROD)).toBe(RAIDHELPER_BUDGET.write);
            expect(RAIDHELPER_BUDGET.background).toBeLessThan(RAIDHELPER_BUDGET.read);
            expect(RAIDHELPER_BUDGET.write + RAIDHELPER_BUDGET.dev).toBeLessThan(RAIDHELPER_BUDGET.limit);
        });

        it("gives a dev instance the small dev budget and no background requests unless asked for", () => {
            expect(budget.capFor("read", DEV)).toBe(RAIDHELPER_BUDGET.dev);
            expect(budget.capFor("write", DEV)).toBe(RAIDHELPER_BUDGET.dev);
            expect(budget.capFor("background", DEV)).toBe(0);
            expect(budget.capFor("background", { ...DEV, RAIDHELPER_BACKGROUND: "1" })).toBe(RAIDHELPER_BUDGET.dev);
        });
    });

    describe("check / record", () => {
        it("counts hour by hour and forgets what is older than 24 hours", () => {
            budget.record({ now: NOW });
            budget.record({ now: NOW });
            budget.record({ now: NOW - 23 * HOUR });
            fill({ ...budgetStore.readBudget().hours, [hourOf(NOW - 25 * HOUR)]: 500 });
            expect(budget.status({ now: NOW, env: PROD }).used).toBe(3);
            budget.record({ now: NOW });
            expect(Object.keys(budgetStore.readBudget().hours)).not.toContain(hourOf(NOW - 25 * HOUR));
        });

        it("lets a request through below its cap", () => {
            fill({ [hourOf(NOW)]: RAIDHELPER_BUDGET.background - 1 });
            expect(() => budget.check("background", { now: NOW, env: PROD })).not.toThrow();
        });

        it("stops background first, then reads, then writes, and names when it frees up", () => {
            fill({ [hourOf(NOW - 20 * HOUR)]: RAIDHELPER_BUDGET.read, [hourOf(NOW)]: 10 });
            let refusal;
            try {
                budget.check("background", { now: NOW, env: PROD });
            } catch (e) {
                refusal = e;
            }
            expect(budget.isBudgetError(refusal)).toBe(true);
            expect(refusal.message).toMatch(/Raid-Helper-Kontingent geschont: 760 von 1000 Anfragen in 24 h verbraucht – Hintergrundabfragen pausieren ab ca\. \d\d:\d\d Uhr/);
            expect(() => budget.check("read", { now: NOW, env: PROD })).toThrow(/neue Abfragen erst wieder/);
            expect(() => budget.check("write", { now: NOW, env: PROD })).not.toThrow();
        });

        it("refuses background requests on a dev instance without counting anything", () => {
            expect(() => budget.check("background", { now: NOW, env: DEV })).toThrow(/Testinstanzen aus/);
            expect(budget.status({ now: NOW }).used).toBe(0);
        });
    });

    describe("noteRateLimited", () => {
        it("pauses every priority for the hours Raid-Helper names plus one", () => {
            budget.noteRateLimited(JSON.stringify({ reason: "Rate limit encountered: 1000 / 24h. Try again in 3 hour(s).", status: "failed" }), { now: NOW });
            expect(budget.status({ now: NOW }).blockedUntil).toBe(NOW + 4 * HOUR);
            expect(() => budget.check("write", { now: NOW + HOUR, env: PROD })).toThrow(/Tageslimit gemeldet \(Rate limit encountered/);
            expect(() => budget.check("write", { now: NOW + 4 * HOUR + 1, env: PROD })).not.toThrow();
        });

        it("reads \"0 hour(s)\" as one hour, and a body that is no JSON too", () => {
            budget.noteRateLimited("Try again in 0 hour(s)", { now: NOW });
            expect(budget.status({ now: NOW }).blockedUntil).toBe(NOW + HOUR);
        });

        it("never shortens a pause that is already longer", () => {
            budget.noteRateLimited({ reason: "Try again in 5 hour(s)" }, { now: NOW });
            budget.noteRateLimited({ reason: "Try again in 0 hour(s)" }, { now: NOW });
            expect(budget.status({ now: NOW }).blockedUntil).toBe(NOW + 6 * HOUR);
        });
    });

    it("reports the state for the settings page", () => {
        budget.record({ now: NOW });
        expect(budget.status({ now: NOW, env: PROD })).toEqual({
            used: 1,
            limit: 1000,
            caps: { background: RAIDHELPER_BUDGET.background, read: RAIDHELPER_BUDGET.read, write: RAIDHELPER_BUDGET.write },
            blockedUntil: 0,
        });
    });
});
