import { useEffect, useRef, useState } from "react";
import {
    searchRaiders, type AvailabilityCharacter, type AvailabilityKind, type AvailabilityRaid, type AvailabilityResult,
    type AvailabilityServer, type RaiderRef,
} from "../../api";
import { Badge, Button, IconButton, WowIcon } from "../ui";
import Chip from "../ui/Chip";
import { CheckMark, RosterIcon, SearchIcon, XIcon } from "../ui/icons/icons";
import { formatDayDate, formatTime } from "../../lib/format";
import { SIGNUP_STATUS, statusBadgeLabel } from "../../lib/signups/status";
import { raidFixed, skipReason, type CharPick, type ScopePick } from "../../lib/signups/availability";
import { categoryIcon, plainCategoryName } from "../../lib/roster/absences";
import { classIconName } from "../../lib/roster/rosterView";
import { classColorOf } from "../../lib/discord/members";
import { specLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";

// The parts of the absence/attendance dialog (AvailabilityDialog.tsx): where the
// entry holds (servers and their categories), the characters of an attendance,
// the raids of the period as toggle rows, the orga's "für Raider" picker, and
// the answer of a save, raid by raid.

/** When a raid starts, short: "Fr 09.10. 19:45". */
function when(startTime: number): string {
    const ms = startTime * 1000;
    return `${formatDayDate(ms)} ${formatTime(ms)}`;
}

// The crest in front of a server's name when it has no Discord icon (as in the sidebar's server head).
const GUILD_ICON = "inv_misc_tabardpvp_01";

/** A server's Discord icon, the crest without one (or when it does not load). */
function ServerIcon({ server }: { server: AvailabilityServer }) {
    const [broken, setBroken] = useState(false);
    if (!server.icon || broken) return <WowIcon name={GUILD_ICON} size={18} />;
    return <img className="an-av-srv-ico" src={server.icon} alt="" width={18} height={18} onError={() => setBroken(true)} />;
}

/** One server's chips: "Alle Kategorien" and each category with its icon — several may be on. */
function ServerChips({ server, pick, onAll, onCategory, label }: {
    server: AvailabilityServer;
    pick: ScopePick[string] | undefined;
    onAll: () => void;
    onCategory: (id: string) => void;
    label: string;
}) {
    const t = useT();
    const all = pick === "all";
    return (
        <div className="chip-row" role="group" aria-label={label}>
            <Chip pressed={all} tone={all ? "accent" : undefined} icon={all ? <CheckMark /> : undefined} onClick={onAll}>
                {t("signups.availability.dialog.allOfServer")}
            </Chip>
            {server.categories.map((c) => {
                const on = Array.isArray(pick) && pick.includes(c.id);
                return (
                    <Chip key={c.id} pressed={on} tone={on ? "accent" : undefined}
                        icon={<WowIcon name={categoryIcon(c.icon)} size={16} />} onClick={() => onCategory(c.id)}>
                        {plainCategoryName(c.name)}
                    </Chip>
                );
            })}
        </div>
    );
}

/**
 * Where an entry holds: one block per server (icon and name as a small heading,
 * below it the chips); one server alone without its heading.
 */
export function ScopePicker({ servers, pick, onAll, onCategory }: {
    servers: AvailabilityServer[];
    pick: ScopePick;
    onAll: (guildId: string) => void;
    onCategory: (guildId: string, categoryId: string) => void;
}) {
    const t = useT();
    if (servers.length === 1) {
        const only = servers[0];
        return <ServerChips server={only} pick={pick[only.guildId]} onAll={() => onAll(only.guildId)}
            onCategory={(id) => onCategory(only.guildId, id)} label={t("signups.availability.dialog.category")} />;
    }
    return (
        <div className="an-av-servers">
            {servers.map((s) => (
                <div key={s.guildId} className="an-av-srv">
                    <div className="an-av-srv-head"><ServerIcon server={s} /><span>{s.name}</span></div>
                    <ServerChips server={s} pick={pick[s.guildId]} onAll={() => onAll(s.guildId)}
                        onCategory={(id) => onCategory(s.guildId, id)} label={t("signups.availability.dialog.serverAria", { name: s.name })} />
                </div>
            ))}
        </div>
    );
}

/**
 * The characters of an attendance: one row each (class icon, name in its class
 * colour — a click puts it in or out) with its spec beside it; one group per game
 * version when the picked categories play more than one.
 */
export function CharacterRows({ groups, picked, versionName, onToggle, onSpec }: {
    groups: { versionId: string; characters: AvailabilityCharacter[] }[];
    /** key -> spec of the characters in. */
    picked: CharPick;
    versionName: (versionId: string) => string;
    onToggle: (character: AvailabilityCharacter) => void;
    onSpec: (key: string, spec: string) => void;
}) {
    const t = useT();
    return (
        <div className="an-av-chargroups">
            {groups.map((g) => (
                <div key={g.versionId} className="an-av-chargroup">
                    {groups.length > 1 && <div className="an-av-version">{versionName(g.versionId)}</div>}
                    <ul className="an-av-chars">
                        {g.characters.map((c) => {
                            const spec = picked[c.key] || "";
                            const on = !!spec;
                            const color = classColorOf(c.className);
                            return (
                                <li key={c.key} className={on ? "an-av-char" : "an-av-char an-av-off"}>
                                    <button type="button" className="an-av-toggle" aria-pressed={on} onClick={() => onToggle(c)}
                                        aria-label={t("signups.availability.dialog.charAria", { name: c.name })}>
                                        <span className="an-av-mark">{on && <CheckMark />}</span>
                                        <WowIcon name={classIconName(c.className)} size={20} />
                                        <span className="an-av-charname" style={color ? { color } : undefined}>{c.name}</span>
                                    </button>
                                    <select className="inp-sm" value={spec || c.specs[0]?.key || ""} aria-label={t("signups.availability.dialog.specAria", { name: c.name })}
                                        onChange={(e) => onSpec(c.key, e.target.value)}>
                                        {c.specs.map((s) => <option key={s.key} value={s.key}>{specLabel(s.key, s.label)}</option>)}
                                    </select>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/**
 * The raids the period covers — all picked at first; a click leaves one out. A
 * raid the save leaves alone anyway (raidFixed: already so, already done by the
 * entry being edited, or covered by an absence) stays unpicked and greyed out.
 */
export function RaidChecklist({ kind, raids, off, onToggle }: {
    kind: AvailabilityKind;
    raids: AvailabilityRaid[];
    /** The ids left out. */
    off: Set<string>;
    onToggle: (id: string) => void;
}) {
    const t = useT();
    return (
        <ul className="an-av-raids">
            {raids.map((r) => {
                const fixed = raidFixed(kind, r);
                const picked = !fixed && !off.has(r.id);
                return (
                    <li key={r.id}>
                        <button type="button" className={`an-av-raid an-av-toggle${picked ? "" : " an-av-off"}`} aria-pressed={picked} disabled={fixed}
                            onClick={() => onToggle(r.id)} aria-label={t("signups.availability.dialog.raidAria", { title: r.title })}>
                            <span className="an-av-mark">{picked && <CheckMark />}</span>
                            <span className="an-av-text">
                                <span className="an-av-title">{r.title}</span>
                                <span className="an-av-when">{[when(r.startTime), r.categoryName].filter(Boolean).join(" · ")}</span>
                            </span>
                            {r.applied ? <Badge size="sm" tone="ok" tip={t("signups.availability.dialog.appliedTip")}>{t("signups.availability.dialog.applied")}</Badge>
                                : kind === "presence" && r.absent ? <Badge size="sm" tone="bad" tip={t("signups.availability.dialog.absentTip")}>{t("signups.availability.dialog.absentFixed")}</Badge>
                                    : r.status ? <Badge size="sm" tone={SIGNUP_STATUS[r.status].tone}>{statusBadgeLabel(r.status)}</Badge> : null}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * The orga's way to enter for somebody else: a quiet button that opens a raider
 * search (the wish picker's GET /api/profile/raiders), then the chosen raider as
 * a removable badge.
 */
export function RaiderPick({ target, onPick }: { target: RaiderRef | null; onPick: (raider: RaiderRef | null) => void }) {
    const t = useT();
    const [searching, setSearching] = useState(false);
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<RaiderRef[]>([]);
    const timer = useRef<number | undefined>(undefined);
    const input = useRef<HTMLInputElement>(null);

    // the search was opened on purpose, so it takes the focus
    useEffect(() => { if (searching) input.current?.focus(); }, [searching]);

    useEffect(() => {
        window.clearTimeout(timer.current);
        if (!q.trim()) { setHits([]); return undefined; }
        timer.current = window.setTimeout(() => {
            // a failed search just shows no hits — the field stays usable
            searchRaiders(q).then((r) => setHits(r.raiders)).catch(() => setHits([]));
        }, 250);
        return () => window.clearTimeout(timer.current);
    }, [q]);

    if (target) {
        const name = target.name || target.character;
        return (
            <div className="an-av-who">
                <Badge tone="accent" icon={<RosterIcon />} onRemove={() => onPick(null)} removeTip={t("signups.availability.dialog.backToMe")}>
                    {t("signups.availability.dialog.forName", { name })}
                </Badge>
            </div>
        );
    }
    if (!searching) {
        return (
            <div className="an-av-who">
                <Button variant="ghost" size="sm" icon={<RosterIcon />} onClick={() => setSearching(true)}
                    data-tip={t("signups.availability.dialog.forRaider")} data-tip-sub={t("signups.availability.dialog.forRaiderSub")}>
                    {t("signups.availability.dialog.forRaider")}
                </Button>
            </div>
        );
    }
    return (
        <div className="an-av-who an-av-search">
            <div className="an-av-q">
                <SearchIcon />
                <input ref={input} className="inp-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("signups.availability.dialog.searchRaider")} aria-label={t("signups.availability.dialog.searchRaiderAria")} />
                <IconButton size="sm" icon={<XIcon />} tip={t("signups.availability.dialog.backToMe")} onClick={() => { setQ(""); setSearching(false); }} />
            </div>
            {hits.slice(0, 6).map((h) => (
                <button key={h.userId} type="button" className="an-av-hit" onClick={() => { onPick(h); setQ(""); setSearching(false); }}>
                    <b>{h.character || h.name}</b>
                    {h.character && h.name && <span>{h.name}</span>}
                </button>
            ))}
        </div>
    );
}

/** The answer of a save, raid by raid: done, skipped (already so) or not changed, with why. */
export function ResultList({ results }: { results: AvailabilityResult[] }) {
    const t = useT();
    return (
        <ul className="an-results">
            {results.map((r) => (
                <li key={r.eventId} className="an-result">
                    <Badge tone={r.ok ? "ok" : r.skipped ? undefined : "bad"}>
                        {r.ok ? t("signups.availability.result.done") : r.skipped ? t("signups.availability.result.skippedBadge") : t("signups.availability.result.failedBadge")}
                    </Badge>
                    <span className="an-result-title">{r.title}</span>
                    <span className="an-result-text">
                        {when(r.startTime)}
                        {!r.ok && <span className="an-result-skip">{skipReason(r)}</span>}
                    </span>
                </li>
            ))}
        </ul>
    );
}
