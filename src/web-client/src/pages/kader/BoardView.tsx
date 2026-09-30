// The Kader-Board (/kader): the pool on the left (everyone not in the roster,
// grouped by role), the roster by role slots in the middle with the bench under
// it, and on the right what the roster brings — class mix, raid buffs, average
// attendance. Drag a player between them, or use the "+" buttons and the empty
// slots (they open a picker) without a mouse.
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { KaderPlayer, KaderRole } from "../../api";
import { Button, IconButton, IconTile } from "../../components/ui";
import { AlertIcon, CheckIcon, EditIcon, PlusIcon, SearchIcon } from "../../components/icons";
import { classColorProps } from "../../components/ClassSpec";
import { useT } from "../../i18n";
import { rolePluralLabel } from "../../lib/wowNames";
import { activeOf, attSortValue, averageAttendance, classCounts, className, colorOf, raidBuffStatus, roleCards, searchText, specName, ROLES } from "../../lib/kader/model";
import { buttonClass } from "../../components/ui/Button";
import { useKader } from "./kaderContext";
import { dragProps, useDropZone } from "./dnd";
import { CharName, ClassBar, Meter, PlayerIcon, RoleIcon } from "./parts";
import { attText } from "../../lib/kader/model";

function PoolRow({ player, benched }: { player: KaderPlayer; benched: boolean }) {
    const t = useT();
    const { view, roster, place, open, canWrite } = useKader();
    const a = activeOf(player);
    const full = !!roster && roster.members.length >= roster.size;
    const sub = a
        ? [specName(view.classes, a.mainSpec) || className(view.classes, a.className), a.canHeal && a.role !== "healer" ? t("kader.player.canHeal") : "", a.canTank && a.role !== "tank" ? t("kader.player.canTank") : ""].filter(Boolean).join(" · ")
        : t("kader.player.noCharLong");
    return (
        <div className="kp-prow" {...dragProps(player.userId, canWrite)}>
            <button type="button" className="kp-prow-main" onClick={() => open({ type: "account", userId: player.userId })}>
                <ClassBar color={colorOf(view.classes, player)} />
                <PlayerIcon player={player} />
                <span className="kp-prow-text">
                    <CharName player={player} className="kp-prow-name" />
                    <span className="kp-sub">@{player.displayName} · {sub}{benched ? ` · ${t("kader.status.bench")}` : ""}</span>
                </span>
                <span className="kp-prow-att">
                    <span className="kp-mono">{attText(player)}</span>
                    {player.attendance && <Meter pct={player.attendance.pct} />}
                </span>
            </button>
            {canWrite && (
                <IconButton
                    icon={<PlusIcon />}
                    size="sm"
                    tip={full ? t("kader.pool.full") : t("kader.pool.addTo")}
                    aria-label={t("kader.pool.addToNamed", { name: a ? a.name : player.displayName })}
                    disabled={!roster || full}
                    onClick={() => void place(player.userId, "role")}
                />
            )}
        </div>
    );
}

function PoolPanel() {
    const t = useT();
    const { view, roster, place, open, canWrite } = useKader();
    const [q, setQ] = useState("");
    const drop = useDropZone((id) => void place(id, "free"), canWrite && !!roster);

    const { groups, benched } = useMemo(() => {
        const inKader = new Set(roster ? roster.members.map((m) => m.userId) : []);
        const bench = new Set(roster ? roster.bench : []);
        const needle = q.trim().toLowerCase();
        const list = view.players
            .filter((p) => !inKader.has(p.userId))
            .filter((p) => !needle || searchText(p, view.classes).includes(needle))
            .sort((a, b) => attSortValue(b) - attSortValue(a));
        const defs: { key: string; role: KaderRole | null; title: string; items: KaderPlayer[] }[] = ROLES.map((r) => ({ key: r, role: r, title: rolePluralLabel(r), items: list.filter((p) => activeOf(p)?.role === r) }));
        defs.push({ key: "none", role: null, title: t("kader.group.noRole"), items: list.filter((p) => !activeOf(p)?.role) });
        return { groups: defs.filter((g) => g.items.length), benched: bench };
    }, [view, roster, q, t]);

    return (
        <section className={`kp-panel kp-pool${drop.over ? " kp-over" : ""}`} {...drop.props} aria-label={t("kader.pool.title")}>
            <div className="kp-panel-head">
                <h2>{t("kader.pool.title")}</h2>
                <span className="kp-mono kp-muted" data-tip={t("kader.pool.countTip")}>{view.players.length}</span>
            </div>
            <label className="kp-search">
                <SearchIcon />
                <input type="search" aria-label={t("kader.pool.search")} placeholder={t("kader.pool.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="kp-pool-list">
                {groups.length === 0 && <div className="kp-empty">{view.players.length ? t("kader.pool.nobody") : t("kader.pool.noAccounts")}</div>}
                {groups.map((g) => (
                    <div key={g.key}>
                        <div className="kp-glabel">{g.role && <RoleIcon role={g.role} size={16} />}<span className="kicker">{g.title}</span><span className="kp-rule" /><span className="kicker">{g.items.length}</span></div>
                        {g.items.map((p) => <PoolRow key={p.userId} player={p} benched={benched.has(p.userId)} />)}
                    </div>
                ))}
            </div>
            <div className="kp-pool-foot">
                <Link to="/kader/spieler" className={buttonClass("ghost", "sm", true)}><SearchIcon />{t("kader.pool.find")}</Link>
                {canWrite && <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={() => open({ type: "add" })}>{t("kader.pool.addAccount")}</Button>}
            </div>
        </section>
    );
}

function Slot({ player, role }: { player: KaderPlayer | null; role: KaderRole }) {
    const t = useT();
    const { view, open, canWrite } = useKader();
    if (!player) {
        return canWrite
            ? <button type="button" className="kp-slot kp-free" onClick={() => open({ type: "picker", role })} aria-label={t("kader.slot.pickFor", { role: rolePluralLabel(role) })}>{t("kader.slot.free")}</button>
            : <span className="kp-slot kp-free">{t("kader.slot.freeRead")}</span>;
    }
    const a = activeOf(player);
    return (
        <button type="button" className="kp-slot" {...dragProps(player.userId, canWrite)} onClick={() => open({ type: "account", userId: player.userId })}>
            <ClassBar color={colorOf(view.classes, player)} small />
            <PlayerIcon player={player} />
            <span className="kp-slot-text">
                <CharName player={player} className="kp-slot-name" />
                <span className="kp-sub">
                    {a ? specName(view.classes, a.mainSpec) || className(view.classes, a.className) : t("kader.player.noChar")}
                    {player.attendance && <span className="kp-mono"> · {attText(player)}</span>}
                </span>
            </span>
            {player.differs.length > 0 && <span className="kp-diff" data-tip={t("kader.diff.tip")} aria-label={t("kader.diff.tip")}>≠</span>}
        </button>
    );
}

function RoleCardView({ role, target, count, slots }: { role: KaderRole; target: number; count: number; slots: (KaderPlayer | null)[] }) {
    const { place, canWrite } = useKader();
    const drop = useDropZone((id) => void place(id, "role", role), canWrite);
    const tone = count > target ? "kp-above" : count === target ? "kp-full" : "kp-short";
    return (
        <div className={`kp-panel kp-role${drop.over ? " kp-over" : ""}`} {...drop.props}>
            <div className="kp-panel-head">
                <h3 className="kp-iconlabel"><RoleIcon role={role} />{rolePluralLabel(role)}</h3>
                <span className={`kp-mono kp-count ${tone}`}>{count} / {target}</span>
            </div>
            <div className="kp-slots">
                {slots.map((p, i) => <Slot key={p ? p.userId : `free-${i}`} player={p} role={role} />)}
            </div>
        </div>
    );
}

function Bench() {
    const t = useT();
    const { view, roster, players, place, open, canWrite } = useKader();
    const drop = useDropZone((id) => void place(id, "bench"), canWrite);
    const benched = (roster ? roster.bench : []).map((id) => players.get(id)).filter((p): p is KaderPlayer => !!p);
    return (
        <div className={`kp-bench${drop.over ? " kp-over" : ""}`} {...drop.props}>
            <span className="kicker">{t("kader.bench.title")}</span>
            {benched.map((p) => (
                <button key={p.userId} type="button" className="kp-bench-chip" {...dragProps(p.userId, canWrite)} onClick={() => open({ type: "account", userId: p.userId })}>
                    <span className={colorOf(view.classes, p) ? "class-colored" : ""} style={classColorProps(colorOf(view.classes, p)).style}>{activeOf(p)?.name || p.displayName}</span>
                </button>
            ))}
            {!benched.length && <span className="kp-hint">{t("kader.bench.hint")}</span>}
        </div>
    );
}

function SidePanels() {
    const t = useT();
    const { view, roster, players } = useKader();
    if (!roster) return null;
    const counts = classCounts(roster, players, view.classes);
    const max = Math.max(1, ...counts.map((c) => c.n));
    const buffs = raidBuffStatus(roster, players, view.buffs.raid);
    const avg = averageAttendance(roster, players);
    return (
        <aside className="kp-side">
            <div className="kp-panel kp-sidecard">
                <span className="kicker">{t("kader.side.classes")}</span>
                {counts.length === 0 && <span className="kp-hint">{t("kader.side.nobody")}</span>}
                {counts.map((c) => (
                    <div key={c.key} className="kp-classrow" style={{ "--cc": c.color || "var(--muted)" } as CSSProperties}>
                        <span className="kp-classname class-colored">{className(view.classes, c.key)}</span>
                        <span className="kp-classbar"><i style={{ "--fill": `${(c.n / max) * 100}%` } as CSSProperties} /></span>
                        <span className="kp-mono">{c.n}</span>
                    </div>
                ))}
            </div>
            <div className="kp-panel kp-sidecard">
                <div className="kp-panel-head">
                    <span className="kicker">{t("kader.side.buffs")}</span>
                    <span className="kp-mono">{buffs.filter((b) => b.ok).length} / {buffs.length}</span>
                </div>
                {buffs.map(({ buff, ok }) => (
                    <div key={buff.key} className={`kp-buff${ok ? " kp-ok" : " kp-miss"}`}>
                        {ok ? <CheckIcon /> : <AlertIcon />}
                        <span>{buff.label}</span>
                    </div>
                ))}
            </div>
            <div className="kp-panel kp-sidecard">
                <span className="kicker">{t("kader.side.attendance")}</span>
                <span className="kp-big kp-mono">{avg === null ? "—" : `${avg} %`}</span>
                <span className="kp-sub">{avg === null ? t("kader.side.attendanceNone") : t("kader.side.attendanceSub")}</span>
            </div>
        </aside>
    );
}

function RosterArea() {
    const t = useT();
    const { roster, players, open, canWrite } = useKader();
    if (!roster) {
        return (
            <section className="kp-center">
                <div className="kp-panel kp-noroster">
                    <h2>{t("kader.board.noRoster")}</h2>
                    <p className="kp-hint">{canWrite ? t("kader.board.noRosterHint") : t("kader.board.noRosterRead")}</p>
                    {canWrite && <Button icon={<PlusIcon />} onClick={() => open({ type: "roster", mode: "new" })}>{t("kader.roster.create")}</Button>}
                </div>
            </section>
        );
    }
    return (
        <section className="kp-center">
            <div className="kp-roles">
                {roleCards(roster, players).map((c) => <RoleCardView key={c.role} {...c} />)}
            </div>
            <Bench />
        </section>
    );
}

/** The head of the board: which roster, how full, the way to the setup. */
function BoardHead() {
    const t = useT();
    const navigate = useNavigate();
    const { view, roster, selectRoster, open, canWrite } = useKader();
    return (
        <div className="kp-head">
            <IconTile icon="inv_misc_groupneedmore" tone="kader" size="lg" />
            <div className="kp-head-text">
                <div className="kicker">{t("kader.board.kicker")}</div>
                <div className="kp-rostersel">
                    <select
                        className="kp-select"
                        aria-label={t("kader.board.pickRoster")}
                        value={roster ? roster.id : ""}
                        onChange={(e) => {
                            if (e.target.value === "__new") open({ type: "roster", mode: "new" });
                            else selectRoster(e.target.value);
                        }}
                    >
                        {!roster && <option value="">{t("kader.board.noRoster")}</option>}
                        {view.rosters.map((r) => <option key={r.id} value={r.id}>{t("kader.roster.label", { name: r.name, size: r.size })}</option>)}
                        {canWrite && <option value="__new">{t("kader.board.newRoster")}</option>}
                    </select>
                    {roster && canWrite && <IconButton icon={<EditIcon />} size="sm" tip={t("kader.roster.edit")} onClick={() => open({ type: "roster", mode: "edit" })} />}
                </div>
            </div>
            {roster && (
                <div className="kp-bigcount" aria-label={t("kader.board.filled", { n: roster.members.length, size: roster.size })}>
                    <span className="kp-mono kp-n">{roster.members.length}</span>
                    <span className="kp-mono kp-of">/ {roster.size}</span>
                </div>
            )}
            <div className="kp-head-act">
                <Button disabled={!roster} onClick={() => roster && navigate(`/kader/setup/${roster.id}`)}>{t("kader.board.toSetup")}</Button>
            </div>
        </div>
    );
}

export default function BoardView() {
    const { view, roster } = useKader();
    return (
        <>
            <BoardHead />
            {view.warnings.length > 0 && <div className="kp-warn" role="status"><AlertIcon />{view.warnings.join(" · ")}</div>}
            <div className={`kp-board${roster ? "" : " kp-noside"}`}>
                <PoolPanel />
                <RosterArea />
                <SidePanels />
            </div>
        </>
    );
}
