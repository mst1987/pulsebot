// Tab "Roster": the raidplan and the attendance in one place, because both
// answer the same question — who is coming? Role and status counts as badges,
// raid groups 1–5 as columns, and below them the two lists a raid lead acts on:
// who has not reacted, and who reacted but is not in the plan.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AttendancePerson, EventSignupEntry, GameRole, SetupPlayer, SetupRole, SignupStatus } from "../../api";
import { wowIconUrl } from "../../lib/wowIcon";
import { CAN_ALSO } from "../../lib/signups";
import { PartHead } from "../../components/ui/PartHead";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import IconTile from "../../components/ui/IconTile";
import Expand from "../../components/ui/Expand";
import WowIcon from "../../components/ui/WowIcon";
import { classColorProps } from "../../components/ClassSpec";
import {
    ROLE_META, ROLE_ORDER, SIGNUP_META, SIGNUP_ORDER, byLabel, personLabel, personRef, slotRef,
    type RaidCtx,
} from "./meta";
import SpecTile from "./SpecTile";

const norm = (s: string) => s.trim().toLowerCase();

/** "4 Magier, 2 Hexenmeister" — the tooltip behind a role badge. */
function classSpread(players: SetupPlayer[]): string {
    const counts = new Map<string, number>();
    for (const p of players) {
        const label = p.specName || p.className || "Unbekannt";
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label}`).join(", ");
}

/** One person as a chip: spec tile + name, or the Discord name when no character is known. */
function PersonChip({ p, status, onOpen }: { p: AttendancePerson; status?: SignupStatus; onOpen: () => void }) {
    const prof = p.profile;
    const discordName = p.displayName || p.id;
    const label = personLabel(p);
    const tipSub = [status ? SIGNUP_META[status].label : "", prof?.specName, p.character ? `@${discordName}` : ""].filter(Boolean).join(" · ");
    return (
        <button type="button" className="rd-chip" data-tip={label} data-tip-sub={tipSub || undefined} onClick={onOpen}>
            {prof ? <SpecTile iconUrl={prof.iconUrl} classColor={prof.classColor} size="sm" /> : null}
            <span {...classColorProps(prof?.classColor)}>{p.character ? label : `@${discordName}`}</span>
            {!p.character && <Badge>kein Charakter</Badge>}
            {status && status !== "signed" && <Badge tone={SIGNUP_META[status].tone}>{SIGNUP_META[status].label}</Badge>}
        </button>
    );
}

const OWN_ROLES: GameRole[] = ["tank", "healer", "melee", "ranged"];

/**
 * An own event's signups (#256) in role columns — one compact line per raider:
 * spec tile, character, and two small marks when there is more to know. What
 * they "can also" do and their comment sit in the tooltip, never in the row.
 * The sign-offs are one badge with the names in its tooltip.
 */
function OwnSignupGroups({ signups, openPlayer }: { signups: EventSignupEntry[]; openPlayer: RaidCtx["openPlayer"] }) {
    const coming = signups.filter((s) => s.status !== "absence");
    const absent = signups.filter((s) => s.status === "absence");
    if (!signups.length) return <p className="rd-empty">Noch niemand hat sich im EventHelper angemeldet.</p>;
    return (
        <>
            <div className="rd-groups rd-own">
                {OWN_ROLES.map((role) => {
                    const list = coming.filter((s) => s.role === role);
                    return (
                        <div className="rd-group" key={role}>
                            <div className="rd-group-head"><span className="kicker">{ROLE_META[role].label}</span><Badge count>{list.length}</Badge></div>
                            <div className="rd-plist">
                                {list.map((s) => {
                                    const also = s.canAlso.map((r) => CAN_ALSO[r].label).join(", ");
                                    const sub = [
                                        s.specLabel,
                                        s.status !== "signed" ? SIGNUP_META[s.status].label : "",
                                        s.name ? `@${s.name}` : "",
                                        also ? `kann auch: ${also}` : "",
                                        s.comment ? `„${s.comment}“` : "",
                                    ].filter(Boolean).join(" · ");
                                    const color = classColorProps(s.classColor);
                                    return (
                                        <button
                                            type="button" key={s.userId} className="rd-pl"
                                            data-tip={s.character || s.name || s.userId} data-tip-sub={sub || undefined}
                                            onClick={() => openPlayer({
                                                name: s.character || s.name, discordName: s.name || undefined, classColor: s.classColor,
                                                className: s.className, specName: s.specLabel, iconUrl: wowIconUrl(s.specIcon, 36),
                                                role: s.role || undefined, status: s.status,
                                            })}
                                        >
                                            <SpecTile iconUrl={s.specIcon ? wowIconUrl(s.specIcon, 36) : undefined} classColor={s.classColor} />
                                            <span className="rd-pl-text">
                                                <span className={`rd-pname ${color.className || ""}`} style={color.style}>{s.character || s.name}</span>
                                                <span className="rd-pspec">{s.specLabel}</span>
                                            </span>
                                            <span className="rd-own-marks">
                                                {s.canAlso.length > 0 && <span className="rd-own-mark" aria-label={`kann auch: ${also}`}>+{s.canAlso.length}</span>}
                                                {s.comment && <span className="rd-own-mark" aria-label="Kommentar">…</span>}
                                            </span>
                                            {s.status !== "signed" && <span className={`rd-sig rd-sig-${s.status}`} aria-label={SIGNUP_META[s.status].label} />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
            {absent.length > 0 && (
                <div className="rd-badges">
                    <Badge
                        tone="bad"
                        tip={`${absent.length} abgemeldet`}
                        tipSub={absent.map((s) => [s.character || s.name || s.userId, s.comment ? `„${s.comment}“` : ""].filter(Boolean).join(" ")).join(", ")}
                    >
                        {absent.length} abgemeldet
                    </Badge>
                </div>
            )}
        </>
    );
}

/** The state badge in the part head when the attendance check cannot run. */
function AttendanceState({ ctx }: { ctx: RaidCtx }) {
    const { data } = ctx;
    if (!data.attendanceRoleIds.length) {
        return (
            <Link
                className="badge mid rd-badge-link" to="/settings?section=kategorien"
                data-tip="Keine Raider-Rollen" data-tip-sub="Dieser Kategorie sind noch keine Raider-Rollen zugeordnet. Klick öffnet Einstellungen › Kategorien."
            >
                keine Raider-Rollen
            </Link>
        );
    }
    if (data.event.signupsKnown === false) {
        return (
            <Badge tone="mid" tip="Anmeldungen unbekannt" tipSub="Raid-Helper liefert für diesen vergangenen Raid keine Anmeldungen mehr, und es wurde keine gespeichert. Ohne sie würden alle als „fehlt“ gelten.">
                Anmeldungen unbekannt
            </Badge>
        );
    }
    if (data.membersError) {
        return (
            <Badge tone="bad" tip="Mitglieder nicht geladen" tipSub={`${data.membersError} — für den Rollen-Abgleich muss im Discord Developer Portal der „Server Members Intent“ aktiv sein.`}>
                Members Intent fehlt
            </Badge>
        );
    }
    return null;
}

export default function RosterTab({ ctx }: { ctx: RaidCtx }) {
    const { data, openModal, openPlayer } = ctx;
    const { setup, setupError, setupFromSnapshot, attendance, event: ev } = data;
    const attendanceOk = !!data.attendanceRoleIds.length && ev.signupsKnown !== false && !data.membersError;
    const missing = attendanceOk ? [...attendance.missing].sort(byLabel) : [];
    const responded = useMemo(() => (attendanceOk ? attendance.responded : []), [attendanceOk, attendance.responded]);

    const players = useMemo(() => (setup?.groups || []).flatMap((g) => g.players), [setup]);
    const inSetup = useMemo(() => new Set(players.map((p) => norm(p.name))), [players]);
    // A raidplan slot only knows a character name; its reaction is found through
    // the raider→character assignment the attendance list carries.
    const statusByName = useMemo(() => {
        const m = new Map<string, SignupStatus>();
        for (const p of responded) if (p.character) m.set(norm(p.character), p.status || "signed");
        return m;
    }, [responded]);
    const notInSetup = responded.filter((p) => !p.character || !inSetup.has(norm(p.character))).sort(byLabel);

    const [missingOpen, setMissingOpen] = useState(missing.length > 0);
    const [asideOpen, setAsideOpen] = useState(false);

    const byRole = useMemo(() => {
        const m = new Map<SetupRole, SetupPlayer[]>();
        for (const p of players) {
            const role = p.role || "dps";
            m.set(role, [...(m.get(role) || []), p]);
        }
        return m;
    }, [players]);

    const statusCounts = SIGNUP_ORDER
        .map((s) => ({ status: s, n: responded.filter((p) => (p.status || "signed") === s).length }))
        .filter((x) => x.n > 0);

    const asideSummary = SIGNUP_ORDER
        .map((s) => ({ s, n: notInSetup.filter((p) => (p.status || "signed") === s).length }))
        .filter((x) => x.n)
        .map((x) => `${x.n} ${SIGNUP_META[x.s].label.toLowerCase()}`)
        .join(" · ");

    const crumb = data.ownSignups
        ? `Anmeldungen im EventHelper${data.categoryName ? ` · „${data.categoryName}“` : ""}`
        : setupFromSnapshot
        ? `Raidplan · ${ev.isPast ? "Stand vom Raidtag" : "gespeicherter Stand"} (lokal gespeichert)`
        : `Raidplan aus Raid-Helper${data.categoryName ? ` · abgeglichen mit den Raider-Rollen von „${data.categoryName}“` : ""}`;

    const state = <AttendanceState ctx={ctx} />;
    // An own event (#288): the orga signs somebody up from here as well.
    const addRaider = ctx.canManage && data.ownSignups && ev.status !== "cancelled"
        ? (
            <Button variant="ghost" size="sm" icon="inv_misc_groupneedmore" onClick={() => openModal("raider")} data-tip="Raider eintragen" data-tip-sub="Jemanden als Orga an- oder austragen — auch nach dem Anmeldeschluss.">
                Raider eintragen
            </Button>
        )
        : null;
    const pingAction = !ev.isPast && missing.length && ev.status !== "cancelled"
        ? (
            <Button variant="ghost" size="sm" icon="inv_letter_15" onClick={() => openModal("ping")} data-tip="Fehlende pingen" data-tip-sub="Postet im Event-Channel und pingt genau die Raider ohne Reaktion.">
                Fehlende pingen<Badge tone="bad" count>{missing.length}</Badge>
            </Button>
        )
        : null;
    const action = addRaider && pingAction ? <span className="em-head-actions">{addRaider}{pingAction}</span> : addRaider || pingAction;

    return (
        <section className="panel rd-panel">
            <PartHead
                icon="achievement_guildperk_everybodysfriend"
                title="Roster"
                crumb={crumb}
                action={action || (attendanceOk ? null : state)}
            />

            {setupError && <div className="flash flash-err">Setup konnte nicht geladen werden: {setupError}</div>}

            {(players.length > 0 || statusCounts.length > 0 || missing.length > 0) && (
                <div className="rd-badges">
                    {ROLE_ORDER.filter((r) => byRole.get(r)?.length).map((r) => (
                        <Badge key={r} className="rd-role" icon={ROLE_META[r].icon} tip={`${ROLE_META[r].label} · ${byRole.get(r)!.length}`} tipSub={`${classSpread(byRole.get(r)!)}. Rolle aus der Spec im Raidplan, nicht aus der Anmeldung.`}>
                            {ROLE_META[r].label}<b>{byRole.get(r)!.length}</b>
                        </Badge>
                    ))}
                    {players.length > 0 && (statusCounts.length > 0 || missing.length > 0) && <span className="rd-sep" aria-hidden="true" />}
                    {statusCounts.map(({ status, n }) => (
                        <Badge key={status} tone={SIGNUP_META[status].tone}>{n} {SIGNUP_META[status].label.toLowerCase()}</Badge>
                    ))}
                    {missing.length > 0 && <Badge tone="bad">{missing.length} ohne Reaktion</Badge>}
                </div>
            )}

            {data.ownSignups
                ? <OwnSignupGroups signups={data.ownSignups} openPlayer={openPlayer} />
                : !setup?.total
                ? !setupError && <p className="rd-empty">Für dieses Event ist noch kein Raidplan angelegt.</p>
                : (
                    <div className="rd-groups">
                        {setup.groups.map((g, gi) => (
                            <div className="rd-group" key={gi}>
                                <div className="rd-group-head"><span className="kicker">{g.label}</span><Badge count>{g.players.length}</Badge></div>
                                <div className="rd-plist">
                                    {g.players.map((p, pi) => {
                                        const status = statusByName.get(norm(p.name));
                                        return (
                                            <button
                                                type="button" key={`${p.name}-${pi}`} className="rd-pl"
                                                data-tip={p.name} data-tip-sub={[p.specName, status ? SIGNUP_META[status].label : ""].filter(Boolean).join(" · ") || undefined}
                                                onClick={() => openPlayer(slotRef(p, g.label, status))}
                                            >
                                                <SpecTile iconUrl={p.iconUrl} classColor={p.classColor} />
                                                <span className="rd-pl-text">
                                                    <span className={`rd-pname ${classColorProps(p.classColor).className || ""}`} style={classColorProps(p.classColor).style}>{p.name}</span>
                                                    <span className="rd-pspec">{p.specName}</span>
                                                </span>
                                                {status && status !== "signed" && <span className={`rd-sig rd-sig-${status}`} aria-label={SIGNUP_META[status].label} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

            {attendanceOk && (missing.length > 0 || notInSetup.length > 0) && (
                <div className="rd-glist">
                    <div className={`rd-grp${missingOpen && missing.length ? " open bad" : ""}`}>
                        <IconTile icon="spell_holy_borrowedtime" tone={missing.length ? "bad" : "none"} />
                        <b>Ohne Reaktion</b>
                        <Badge tone={missing.length ? "bad" : undefined} count>{missing.length}</Badge>
                        <span className="rd-grp-sub">Raider-Rolle, aber weder an- noch abgemeldet</span>
                        {missing.length > 0 && <Expand open={missingOpen} onToggle={() => setMissingOpen((o) => !o)} showLabel={!missingOpen} />}
                    </div>
                    {missingOpen && missing.length > 0 && (
                        <div className="rd-chips">
                            {missing.map((p) => <PersonChip key={p.id} p={p} onOpen={() => openPlayer(personRef(p, "missing"))} />)}
                        </div>
                    )}
                    <div className={`rd-grp${asideOpen && notInSetup.length ? " open" : ""}`}>
                        <IconTile icon="spell_holy_divineintervention" tone="none" />
                        <b>Nicht im Setup</b>
                        <Badge count>{notInSetup.length}</Badge>
                        <span className="rd-grp-sub">{asideSummary || "alle Reagierten stehen im Raidplan"}</span>
                        {notInSetup.length > 0 && <Expand open={asideOpen} onToggle={() => setAsideOpen((o) => !o)} showLabel={!asideOpen} />}
                    </div>
                    {asideOpen && notInSetup.length > 0 && (
                        <div className="rd-chips">
                            {notInSetup.map((p) => <PersonChip key={p.id} p={p} status={p.status || "signed"} onOpen={() => openPlayer(personRef(p))} />)}
                        </div>
                    )}
                </div>
            )}

            {attendanceOk && !ev.isPast && !missing.length && responded.length > 0 && (
                <p className="rd-empty"><WowIcon name="achievement_guildperk_everybodysfriend" size={18} />Alle erwarteten Raider haben reagiert.</p>
            )}
        </section>
    );
}
