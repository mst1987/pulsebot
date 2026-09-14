import type { ClaRaid } from "../api";
import Badge from "./ui/Badge";
import { CheckIcon } from "./icons";
import { raidCount, raidIcon } from "../lib/logRaids";
import "../styles/log-auswertung.css";

// The body of the "Raid noch nicht abgeschlossen" question (lib/confirmIncomplete.ts):
// one sentence, then per unfinished raid its bosses as a grid — down with a
// check, still standing dashed — and the raids as count badges. Replaces the
// browser's confirm box, which could only say it in a sentence.

function MissingIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 7v6" /><circle cx="12" cy="17" r=".6" />
        </svg>
    );
}

export default function IncompleteRaid({ raids, message }: { raids?: ClaRaid[]; message: string }) {
    const list = raids || [];
    const open = list.filter((r) => !r.finalKilled);
    if (!open.length) {
        return <div className="la-incomplete"><p>{message}</p></div>;
    }
    const finals = open.map((r) => r.finalBoss || r.label).join(" und ");
    return (
        <div className="la-incomplete">
            <p>
                {finals} {open.length > 1 ? "liegen" : "liegt"} im Log nicht. Wird der Raid noch fortgesetzt, ändern
                weitere Pulls die Zahlen – auswerten lohnt erst danach.
            </p>
            {open.filter((r) => (r.bosses || []).length > 0).map((r) => (
                <div
                    key={r.contentId} className="la-bossgrid" role="list" aria-label={`${r.label}: Bosse`}
                    // a short raid (Hyjal, TK, Gruul) in one row, a long one wraps
                    style={r.bosses.length <= 5 ? { gridTemplateColumns: `repeat(${r.bosses.length}, minmax(0, 1fr))` } : undefined}
                >
                    {r.bosses.map((b) => (
                        <div key={b.name} role="listitem" className={`la-boss ${b.killed ? "ok" : "miss"}`}>
                            <span className="la-boss-i">{b.killed ? <CheckIcon /> : <MissingIcon />}</span>
                            <span>{b.name}</span>
                        </div>
                    ))}
                </div>
            ))}
            <div className="la-incomplete-raids">
                {list.map((r) => (
                    <Badge key={r.contentId} tone={r.finalKilled ? "ok" : "mid"} icon={raidIcon(r.contentId)}>{raidCount(r)}</Badge>
                ))}
            </div>
        </div>
    );
}
