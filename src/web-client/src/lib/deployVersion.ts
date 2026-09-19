// The one line in the menu's footer that says which code is running (#314):
// "Server läuft auf a1b2c3d vom 12.09. · main ist 9 Commits weiter".
//
// Pure and strippable, like lib/eventSeries.ts — test/web-client/deployVersion.test.js
// runs these functions for real. Everything the line does not fit goes into the
// tooltip; the footer stays one quiet line.

/** What GET /api/version answers (src/web/deployStatus.js). */
export type DeployVersion = {
    commit: string;
    short: string;
    committedAt: string;
    subject: string;
    startedAt: string;
    behind: number;
    behindSince: string;
    latest: { commit: string; short: string; committedAt: string; subject: string } | null;
    /** "current" = on main's head, "behind" = n commits back, "unknown" = not comparable. */
    status: "current" | "behind" | "unknown";
    reason: string;
    checkedAt: string;
};

/** "12.09." — the German day of an ISO timestamp, or "" when there is none. */
export function shortDay(iso: string): string {
    if (!iso) return "";
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return "";
    return `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}.`;
}

/** "vor 6 Tagen" / "heute" — how old a timestamp is, in whole days. */
export function daysAgo(iso: string, now = Date.now()): number {
    if (!iso) return 0;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return 0;
    return Math.max(0, Math.floor((now - at.getTime()) / 86400000));
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** The half of the line that names the running commit. */
function runningPart(v: DeployVersion): string {
    if (!v.short) return "Server-Stand unbekannt";
    const day = shortDay(v.committedAt);
    return day ? `Server läuft auf ${v.short} vom ${day}` : `Server läuft auf ${v.short}`;
}

/** The half that names the distance to main — or says it cannot be told. */
function distancePart(v: DeployVersion): string {
    if (v.status === "current") return "aktuell mit main";
    if (v.status === "behind") return `main ist ${plural(v.behind, "Commit", "Commits")} weiter`;
    return "Abstand zu main nicht prüfbar";
}

export type DeployLine = {
    text: string;
    /** The badge tone the dashboard task uses too — here it only colours the dot. */
    tone: "ok" | "mid" | "bad" | "muted";
    tip: string;
    tipSub: string;
};

/**
 * The footer line. Yellow from the first missing commit, red once the oldest
 * missing one is a week old — a week means the deploy is broken, not slow.
 */
export function deployLine(v: DeployVersion | null, now = Date.now()): DeployLine {
    if (!v) return { text: "", tone: "muted", tip: "", tipSub: "" };
    const age = daysAgo(v.behindSince, now);
    const tone = v.status === "current" ? "ok" : v.status === "behind" ? (age >= 7 ? "bad" : "mid") : "muted";
    const text = `${runningPart(v)} · ${distancePart(v)}`;
    return { text, tone, tip: text, tipSub: tipSubOf(v, now) };
}

/** The tooltip body: the commit's subject, how long the server has been behind, and when it was last checked. */
export function tipSubOf(v: DeployVersion, now = Date.now()): string {
    const parts: string[] = [];
    if (v.subject) parts.push(v.subject);
    if (v.status === "behind") {
        const age = daysAgo(v.behindSince, now);
        const since = age > 0 ? ` (seit ${plural(age, "Tag", "Tagen")})` : "";
        const head = v.latest && v.latest.short ? `, main auf ${v.latest.short}` : "";
        parts.push(`Dieser Stand ist ${plural(v.behind, "Commit", "Commits")} hinter main${since}${head}. Das automatische Deployment hat ihn nicht übernommen.`);
    } else if (v.status === "current") {
        parts.push("Der Server läuft auf dem neuesten Stand von main.");
    } else {
        parts.push(reasonText(v.reason));
    }
    if (v.startedAt) parts.push(`Gestartet ${shortDay(v.startedAt)}`);
    return parts.join(" · ");
}

/** Why the comparison failed, in one sentence — never an error, always a state. */
export function reasonText(reason: string): string {
    if (reason === "no_commit") return "Der laufende Prozess kennt seinen Commit nicht (kein Git im Verzeichnis und kein GIT_COMMIT gesetzt).";
    if (reason === "not_found") return "Der laufende Commit steht nicht unter den letzten 100 Commits von main — ein eigener Branch oder ein sehr alter Stand.";
    return "GitHub war nicht erreichbar. Wird alle 10 Minuten erneut versucht.";
}
