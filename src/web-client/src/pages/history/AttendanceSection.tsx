import type { RosterCharData } from "../../api";
import { AttendanceBar } from "../../components/roster/RosterCommon";
import { nightLabel } from "../../lib/rosterView";
import { Badge, PartHead } from "../../components/ui";

export function AttendanceSection({ roster }: { roster: RosterCharData | null }) {
    if (!roster) return <p className="sub">Anwesenheit konnte nicht geladen werden.</p>;
    if (!roster.categories.length) return <p className="sub">Der Charakter gehört zu keiner Raid-Kategorie.</p>;
    return (
        <>
            {roster.categories.map((c) => {
                const a = roster.attendance[c.id];
                const raids = a?.raids || [];
                return (
                    <div key={c.id} className="dash-card ros-part">
                        <PartHead
                            icon={c.icon || "ability_warrior_rallyingcry"}
                            tone="roster"
                            title={c.name}
                            crumb={[...c.contents, raids.length ? `letzte ${raids.length} Raids` : "keine Raids gezählt"].join(" · ")}
                            action={<AttendanceBar attendance={a} categoryName={c.name} />}
                        />
                        {raids.length
                            ? (
                                <div className="ros-nights">
                                    {raids.map((r) => (
                                        <div key={r.eventId} className="ros-night">
                                            <span className="ros-night-date">{nightLabel(r.startTime * 1000)}</span>
                                            <span className="ros-night-title">{r.title || "Raid"}</span>
                                            <Badge tone={r.attended ? "ok" : "bad"} icon={r.attended ? "ability_warrior_rallyingcry" : undefined}>
                                                {r.attended ? "da" : "gefehlt"}
                                            </Badge>
                                            <span className="sub">{r.reason}</span>
                                        </div>
                                    ))}
                                </div>
                            )
                            : <p className="sub ros-empty">Kein zugeordnetes Log und keine Raider-Zuordnung mit Anmeldungen in dieser Kategorie.</p>}
                    </div>
                );
            })}
        </>
    );
}
