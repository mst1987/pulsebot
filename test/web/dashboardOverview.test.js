// The rules behind the start page ("Übersicht"): which raid icon, how full a
// role is, which tasks are open, what the evaluation tile counts.
const {
    zoneFor, raidSize, roleBucket, roleFill, classCounts, notSignedUp,
    openRecommendations, lastReportArea, newLootSince, buildTasks, FALLBACK_ZONE_ICON,
} = require("../../src/web/dashboardOverview");

describe("web/dashboardOverview", () => {
    describe("zoneFor", () => {
        it("names the final boss of the raid a title names", () => {
            expect(zoneFor("Black Temple – Clear")).toEqual({ contentId: "bt", icon: "achievement_boss_illidan" });
            expect(zoneFor("Hyjal Montag").icon).toBe("achievement_boss_archimonde-");
            expect(zoneFor("SSC").icon).toBe("achievement_boss_ladyvashj");
        });

        it("takes the newest content of a combined night", () => {
            expect(zoneFor("Hyjal + BT").contentId).toBe("bt");
        });

        it("never guesses a boss for an unknown title", () => {
            expect(zoneFor("Gildenabend")).toEqual({ contentId: "", icon: FALLBACK_ZONE_ICON });
        });
    });

    describe("raidSize", () => {
        it("prefers the softres list's size, then the content", () => {
            expect(raidSize("bt", 10)).toBe(10);
            expect(raidSize("kara", 0)).toBe(10);
            expect(raidSize("bt", 0)).toBe(25);
            expect(raidSize("", 0)).toBe(25);
        });
    });

    describe("roleBucket / roleFill", () => {
        it("reads Raid-Helper's role name first, the spec second", () => {
            expect(roleBucket({ roleName: "Tanks", specName: "Fury" })).toBe("tank");
            expect(roleBucket({ specName: "Protection1" })).toBe("tank");
            expect(roleBucket({ specName: "Holy1" })).toBe("healer");
            expect(roleBucket({ specName: "Retribution" })).toBe("dps");
            expect(roleBucket({ specName: "" })).toBe("dps");
        });

        it("counts the raidplan when one is built, the attending signups otherwise", () => {
            const signUps = [
                { specName: "Protection1" }, { specName: "Holy1" }, { specName: "Retribution" },
                { specName: "Absence" }, { specName: "Holy1", status: "tentative" },
            ];
            const fromSignups = roleFill({ signUps, size: 25 });
            expect(fromSignups.map((r) => [r.key, r.filled, r.target])).toEqual([["tank", 1, 3], ["healer", 1, 6], ["dps", 1, 16]]);

            const slots = [{ name: "A", specName: "Protection1" }, { name: "B", specName: "Protection1" }, { name: "", specName: "Holy1" }];
            const fromSetup = roleFill({ setupSlots: slots, signUps, size: 10 });
            expect(fromSetup.map((r) => [r.key, r.filled, r.target])).toEqual([["tank", 2, 2], ["healer", 0, 3], ["dps", 0, 5]]);
        });
    });

    it("groups attending signups by class, biggest first", () => {
        const out = classCounts([
            { specName: "Holy1" }, { specName: "Retribution" }, { specName: "Protection1" },
            { specName: "Absence" }, { specName: "Unknown" },
        ]);
        expect(out[0]).toMatchObject({ className: "Paladin", label: "Paladin", count: 3, icon: "classicon_paladin" });
        expect(out).toHaveLength(1);
    });

    it("lists who has not said yes, tentative first, with the assigned character's name", () => {
        const rows = notSignedUp({
            missing: [{ id: "u1", displayName: "Zed" }],
            responded: [
                { id: "u2", displayName: "Anna", status: "tentative", character: "Mondklinge", profile: { className: "Druid", classColor: "#FF7D0A" } },
                { id: "u3", displayName: "Bob", status: "signed" },
                { id: "u4", displayName: "Cid", status: "absence" },
            ],
            specHistory: { u2: "Restoration" },
        });
        expect(rows.map((r) => [r.name, r.status, r.statusLabel])).toEqual([
            ["Mondklinge", "tentative", "Tentative"], ["Zed", "none", "keine Antwort"], ["Cid", "absence", "Abwesend"],
        ]);
        expect(rows[0]).toMatchObject({ className: "Druid", role: "Heiler" });
    });

    it("counts only recommendations nobody decided on", () => {
        expect(openRecommendations(null)).toBe(0);
        expect(openRecommendations({
            raid: [{ approved: null }, { approved: true }],
            players: [{ items: [{ approved: null }, { approved: false }] }, { items: [{ approved: null }] }],
        })).toBe(3);
    });

    describe("lastReportArea", () => {
        it("adds gear, consumables and buffs to the problem count and keeps the parts for the tooltip", () => {
            const area = lastReportArea(
                { id: "r1", title: "BT", zone: "Black Temple", generatedAt: 5 },
                {
                    timeline: { fights: [{ encounterId: 1, kill: false }, { encounterId: 1, kill: true }, { encounterId: 2, kill: true }] },
                    mechanics: { deaths: { total: 7, avoidable: 3 } },
                    players: [{ issues: [1, 2] }, { issues: [3] }],
                    consumables: { players: [{ buffed: 40 }, { buffed: 95 }] },
                    raidBuffs: { players: [{ missing: 2 }, { missing: 0 }] },
                },
            );
            expect(area).toMatchObject({
                id: "r1", icon: "achievement_boss_illidan", bosses: 2, kills: 2, deaths: 7, avoidableDeaths: 3,
                gear: 3, consumables: 1, buffs: 1, problems: 5,
            });
        });

        it("is null without a report and tolerates an unreadable one", () => {
            expect(lastReportArea(null, null)).toBeNull();
            expect(lastReportArea({ id: "r", zone: "" }, null)).toMatchObject({ problems: 0, deaths: null, bosses: 0 });
        });
    });

    it("counts awards since a raid, with a little slack before its start", () => {
        const start = 10 * 3600 * 1000;
        const awards = [{ awardedAt: start + 1 }, { awardedAt: start - 3600 * 1000 }, { awardedAt: start - 7 * 3600 * 1000 }];
        expect(newLootSince(awards, start)).toBe(2);
        expect(newLootSince(awards, 0)).toBe(0);
    });

    describe("buildTasks", () => {
        it("has no task when nothing is open", () => {
            expect(buildTasks({})).toEqual([]);
            expect(buildTasks({
                nextRaids: [{ id: "n1", sheet: { url: "x" } }],
                recentEvents: [{ id: "e1", pendingLogCount: 0 }],
                report: { id: "r1", open: 0 },
                inbox: [],
            })).toEqual([]);
        });

        it("shows every open task once, each leading to where it is done", () => {
            const tasks = buildTasks({
                nextRaids: [{ id: "n1", title: "BT", startTime: 100, sheet: null }, { id: "n2", title: "Hyjal", startTime: 200, sheet: null }],
                recentEvents: [{ id: "e1", title: "Hyjal", startTime: 50, pendingLogCount: 2 }, { id: "e2", pendingLogCount: 1 }],
                report: { id: "r1", zone: "Black Temple", generatedAt: 9, open: 7 },
                inbox: [{ items: [1, 2, 3] }],
            });
            expect(tasks.map((t) => [t.id, t.tone, t.count, t.href])).toEqual([
                ["sheet", "bad", 2, "/raids/detail?event=n1"],
                ["recommendations", "mid", 7, "/r/r1#raid"],
                ["logs", "mid", 3, "/raids/detail?event=e1&tab=logs"],
                ["inbox", "accent", 1, "/history?tab=inbox"],
            ]);
            expect(tasks[0].ref).toEqual({ title: "BT", at: 100000 });
            expect(tasks[3].ref).toEqual({ text: "1 Sitzung · 3 Items" });
            for (const t of tasks) {
                expect(t.tip).toBeTruthy();
                expect(t.tipSub).toBeTruthy();
            }
        });

        it("drops the count badge for a single missing sheet", () => {
            const [task] = buildTasks({ nextRaids: [{ id: "n1", title: "BT", startTime: 1, sheet: null }] });
            expect(task.count).toBe(0);
        });
    });
});

// Role-sync drift (#264) as a dashboard task.
describe("roleDriftTask", () => {
    const { roleDriftTask, buildTasks: tasksFor } = require("../../src/web/dashboardOverview");

    it("has no task without drift", () => {
        expect(roleDriftTask(null)).toBeNull();
        expect(roleDriftTask({ groups: [], total: 0 })).toBeNull();
    });

    it("names the first role and the server the members kept it on", () => {
        const drift = {
            total: 4,
            groups: [
                { roleName: "Raider", guildName: "Pulse Talk", members: [{}, {}, {}] },
                { roleName: "Trial", guildName: "Pulse Talk", members: [{}] },
            ],
        };
        const task = roleDriftTask(drift);
        expect(task).toMatchObject({ id: "rolesync", tone: "mid", count: 4, href: "/settings?section=discordserver" });
        expect(task.ref.text).toBe("3 Mitglieder haben @Raider nur noch auf Pulse Talk · +1 Rolle");
        expect(tasksFor({ roleDrift: drift }).map((t) => t.id)).toEqual(["rolesync"]);
    });
});
