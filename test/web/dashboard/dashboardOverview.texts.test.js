// The start page's tasks carry `texts` (a key under dashboard.task. with its params, per field) so the
// client words them in the reader's language. Every key the server can send must exist in the German
// and the English catalog — else the client falls back to the German text, and English readers see it.
const path = require("path");
const { buildTasks, _internal } = require("../../../src/web/dashboard/dashboardOverview");

const CATALOGS = ["de", "en"].map((lang) => [lang, require(path.join(__dirname, "../../../src/web-client/src/i18n/locales", lang, "dashboard.json")).task]);
const NOW = Date.UTC(2026, 9, 10, 12);

/** Every task kind, each in its variants. */
function allTasks() {
    return [
        ...buildTasks({
            nextRaids: [{ id: "n1", title: "BT", startTime: 100, sheet: null, planning: "sheet" }, { id: "n2", title: "Hyjal", startTime: 200, sheet: null }],
            recentEvents: [{ id: "e1", title: "Hyjal", startTime: 50, pendingLogCount: 2 }],
            report: { id: "r1", zone: "Black Temple", generatedAt: 9, open: 7 },
            inbox: [{ items: [1, 2, 3] }],
            archive: { count: 3, overdue: 1, hintDays: 14 },
            roleDrift: { total: 4, groups: [{ roleName: "Raider", guildName: "Pulse Talk", members: [1, 2] }, { roleName: "Trial", guildName: "", members: [3] }] },
            seriesFailures: [{ categoryName: "Mo Raid", date: "2026-10-12", error: "Event: fehlende Rechte" }, { categoryName: "", date: "2026-10-13", error: "" }],
            // buildTasks counts the days against the real clock
            deploy: { status: "behind", behind: 2, behindSince: new Date(Date.now() - 3 * 86400000 - 60000).toISOString(), short: "8c3cd7f", latest: { short: "ae901bf" } },
            missingChannels: [{ eventId: "eh-1", title: "Karazhan", startTime: 2000, channelName: "mi-kara" }],
            canRecreate: true,
            trials: [
                { rosterId: "r1", rosterName: "Mo", userId: "1", displayName: "Zibbo", trialUntil: new Date(NOW + 86400000).toISOString(), overdue: false, extendTo: "" },
                { rosterId: "r1", rosterName: "Mo", userId: "2", displayName: "Ari", trialUntil: new Date(NOW - 86400000).toISOString(), overdue: true, extendTo: "" },
            ],
        }),
        buildTasks({ archive: { count: 2, overdue: 0, hintDays: 14 } })[0],
        _internal.eventSeriesTask([{ categoryName: "", date: "2026-10-12", error: "" }]),
        _internal.deployTask({ status: "behind", behind: 1, short: "" }, NOW),
        _internal.roleDriftTask({ total: 1, groups: [{ roleName: "Raider", guildName: "", members: [1] }] }),
    ];
}

/** Every key piece of a task's `texts`. */
function keysOf(task) {
    return Object.values(task.texts || {}).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((p) => p.key).map((p) => p.key);
}

describe("dashboard task texts", () => {
    const tasks = allTasks();

    it("gives every task its words as keys, for title, tip and explanation at least", () => {
        for (const task of tasks) {
            expect(task.texts).toBeTruthy();
            expect(task.texts.title).toBeTruthy();
            expect(task.texts.tip).toBeTruthy();
            expect(task.texts.tipSub).toBeTruthy();
        }
        // ten kinds of task, every one of them here
        expect(new Set(tasks.map((t) => t.id.split(":")[0]))).toEqual(new Set(["deploy", "series", "channel-missing", "sheet", "recommendations", "logs", "inbox", "channels", "rolesync", "trial"]));
    });

    it.each(CATALOGS)("finds every key in the %s catalog", (_lang, catalog) => {
        const missing = [...new Set(tasks.flatMap(keysOf))].filter((key) => {
            const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), catalog);
            return !(typeof value === "string" || (value && typeof value.one === "string" && typeof value.other === "string"));
        });
        expect(missing).toEqual([]);
    });

    it("hands the numbers and names over as params, dates as ms for the client to format", () => {
        // the first task of each id (the variants at the end repeat some ids)
        const byId = {};
        for (const task of tasks) if (!byId[task.id]) byId[task.id] = task;
        expect(byId.recommendations.texts.tip).toEqual({ key: "recommendations.tip", params: { count: 7 } });
        expect(byId.inbox.texts.ref).toEqual([{ key: "inbox.sessions", params: { count: 1 } }, { key: "inbox.items", params: { count: 3 } }]);
        expect(byId["channel-missing:eh-1"].texts.action).toEqual({ key: "channelMissing.action", params: {} });
        expect(byId.deploy.texts.title).toEqual([{ key: "deploy.title", params: { count: 2 } }, { key: "deploy.since", params: { count: 3 } }]);
        expect(byId["trial:r1:1"].texts.tip).toEqual({ key: "trial.tip", params: { date: NOW + 86400000 } });
        expect(byId["trial:r1:2"].texts.title).toEqual({ key: "trial.titleOverdue", params: { name: "Ari" } });
        // the series' own error sentence stays as it came, the category is a name
        expect(byId.series.texts.tip).toEqual({ text: "Event: fehlende Rechte" });
        expect(byId.series.texts.ref[0]).toEqual({ text: "Mo Raid" });
        expect(typeof byId.series.texts.ref[1].params.day).toBe("number");
    });
});
