// The "Komposition" tab of a roster (#657, design canvas "Komposition"): the
// places per role against the plan as squares (bench as outlined squares), the
// classes of core and trial, the important buffs of the game version (covered
// by two or more, "knapp" with one, missing) and what is still open - with the
// way to Rekrutierung and Kaderplaner for whoever may open them.
import { Link } from "react-router-dom";
import { getRosterComposition, type RosterComposition, type RosterDetail, type SessionUser } from "../../api";
import { useApi } from "../../hooks/useApi";
import { useLang, useT } from "../../i18n";
import { AsyncView, IconTile, WowIcon, buttonClass } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { AlertIcon, CheckIcon, XIcon } from "../../components/ui/icons";
import { canAccess } from "../../lib/app/access";
import { roleLabel, rolePluralLabel } from "../../lib/wow/wowNames";
import { ROLE_ICONS } from "../../lib/roster/rosters";
import { classIconName } from "../../lib/roster/rosterView";
import { buffState, errorText, slotSquares } from "../../lib/roster/rosterEdit";

type RoleRow = RosterComposition["roles"][number];

/** "1 Tank", "2 Tanks": the role in the number it is counted with. */
function roleWord(role: RoleRow["role"], count: number): string {
    return count === 1 ? roleLabel(role) : rolePluralLabel(role);
}

const BUFF_ORDER = { missing: 0, thin: 1, covered: 2 } as const;

/** One role card: actual against target, a square per place, who fills it. */
function RoleCard({ row, names }: { row: RoleRow; names: string[] }) {
    const t = useT();
    const short = row.target > 0 && row.actual < row.target;
    const squares = slotSquares(row.target, row.actual);
    const label = rolePluralLabel(row.role);
    return (
        <section className="rn-panel rn-pad rn-target" aria-label={label}>
            <div className="rn-target-top">
                <IconTile icon={ROLE_ICONS[row.role]} tone={short ? "mid" : "ok"} />
                <div>
                    <div className="rn-kick">{label}</div>
                    <div className={`rn-big${short ? " rn-tone-mid" : ""}`}>
                        {row.actual}<small>{row.target > 0 ? t("roster.comp.ofPlanned", { target: row.target }) : t("roster.comp.noTarget")}</small>
                    </div>
                </div>
            </div>
            {squares.length > 0 && (
                <div className="rn-slots" role="img" aria-label={t("roster.comp.squaresAria", { actual: row.actual, target: row.target })}>
                    {squares.map((s, i) => <i key={i} className={s === "on" ? "on" : ""} />)}
                </div>
            )}
            <div className="rn-sub">
                {short ? t("roster.comp.missing", { count: row.target - row.actual, role: roleWord(row.role, row.target - row.actual) }) : ""}
                {short && names.length ? " · " : ""}
                {names.join(", ")}
            </div>
        </section>
    );
}

/** The bench card: outlined squares against the bench target. */
function BenchCard({ bench, names }: { bench: RosterComposition["bench"]; names: string[] }) {
    const t = useT();
    const squares = slotSquares(bench.target, bench.actual);
    return (
        <section className="rn-panel rn-pad rn-target" aria-label={t("roster.status.bench")}>
            <div className="rn-target-top">
                <IconTile icon="inv_misc_groupneedmore" tone="none" />
                <div>
                    <div className="rn-kick">{t("roster.status.bench")}</div>
                    <div className="rn-big">{bench.actual}<small>{bench.target > 0 ? t("roster.comp.ofPlanned", { target: bench.target }) : t("roster.comp.noTarget")}</small></div>
                </div>
            </div>
            {squares.length > 0 && (
                <div className="rn-slots" role="img" aria-label={t("roster.comp.squaresAria", { actual: bench.actual, target: bench.target })}>
                    {squares.map((s, i) => <i key={i} className={s === "on" ? "bench" : ""} />)}
                </div>
            )}
            <div className="rn-sub">{names.length ? t("roster.comp.benchReady", { names: names.join(", ") }) : t("roster.comp.benchNone")}</div>
        </section>
    );
}

/** What is still open, as one sentence: missing roles and free places. */
function openSentence(comp: RosterComposition, t: ReturnType<typeof useT>): string {
    const parts = comp.roles.filter((r) => r.target > r.actual).map((r) => t("roster.comp.openRole", { count: r.target - r.actual, role: roleWord(r.role, r.target - r.actual) }));
    if (comp.open > 0) parts.push(t("roster.comp.openPlaces", { count: comp.open }));
    if (comp.unknown > 0) parts.push(t("roster.comp.unknown", { count: comp.unknown }));
    return parts.length ? parts.join(" · ") : t("roster.comp.allFilled");
}

function Composition({ comp, data, user }: { comp: RosterComposition; data: RosterDetail; user: SessionUser | null }) {
    const t = useT();
    const lang = useLang();
    const placed = data.members.filter((m) => m.status === "core" || m.status === "trial");
    const namesOf = (role: string) => placed.filter((m) => m.role === role).map((m) => m.displayName);
    const benchNames = data.members.filter((m) => m.status === "bench").map((m) => m.displayName);
    const nameOf = (userId: string) => data.members.find((m) => m.userId === userId)?.displayName || userId;
    const recruitment = canAccess(user, "recruitment");
    const kader = canAccess(user, "kader");
    const sentence = openSentence(comp, t);
    const anyOpen = comp.roles.some((r) => r.target > r.actual) || comp.open > 0;
    return (
        <div className="rn-comp-page">
            <p className={`rn-open-line${anyOpen ? " is-open" : ""}`}>{anyOpen ? <AlertIcon /> : <CheckIcon />}{sentence}</p>
            <div className="rn-comp">
                {comp.roles.map((row) => <RoleCard key={row.role} row={row} names={namesOf(row.role)} />)}
                <BenchCard bench={comp.bench} names={benchNames} />
            </div>

            <section className="rn-panel rn-pad rn-comp-sec">
                <div className="rn-sec-head"><h2 className="rn-h3">{t("roster.comp.classes")}</h2><span className="rn-sub">{t("roster.comp.classesSub")}</span></div>
                {comp.classes.length ? (
                    <div className="rn-classgrid">
                        {comp.classes.map((c) => (
                            <div key={c.className} className="rn-cls">
                                <WowIcon name={c.icon || classIconName(c.className)} size={34} />
                                <b>{c.count}</b>
                                <span>{lang === "en" ? c.labelEn || c.label : c.label}</span>
                            </div>
                        ))}
                    </div>
                ) : <p className="rn-sub">{t("roster.comp.noClasses")}</p>}
            </section>

            <section className="rn-panel rn-pad rn-comp-sec">
                <div className="rn-sec-head"><h2 className="rn-h3">{t("roster.comp.buffs")}</h2><span className="rn-sub">{t("roster.comp.buffsSub")}</span></div>
                {!comp.buffsAvailable || !comp.buffs.length ? <p className="rn-sub">{t("roster.comp.noBuffs")}</p> : (
                    <ul className="rn-buffs">
                        {[...comp.buffs].sort((a, b) => BUFF_ORDER[buffState(a)] - BUFF_ORDER[buffState(b)]).map((b) => {
                            const state = buffState(b);
                            const who = b.providers.map(nameOf);
                            return (
                                <li key={b.key} className="rn-buff" data-state={state}>
                                    {b.icon && <WowIcon name={b.icon} size={32} />}
                                    <div>
                                        <b>{lang === "en" ? b.labelEn || b.label : b.label}</b>
                                        <span>{who.length ? t("roster.comp.providers", { count: who.length, names: who.join(", ") }) : t("roster.comp.nobody")}</span>
                                    </div>
                                    {state === "covered" && <span className="rn-ok"><CheckIcon />{t("roster.comp.covered")}</span>}
                                    {state === "thin" && <span className="rn-warn" data-tip={t("roster.comp.thinTip")}><AlertIcon />{t("roster.comp.thin")}</span>}
                                    {state === "missing" && <span className="rn-bad"><XIcon />{t("roster.comp.missingBuff")}</span>}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {(recruitment || kader) && (
                    <div className="rn-comp-links">
                        {recruitment && <Link className={buttonClass("ghost", "sm")} to="/recruitment">{t("roster.comp.toRecruitment")}</Link>}
                        {kader && <Link className={buttonClass("ghost", "sm")} to="/kader">{t("roster.comp.toKader")}</Link>}
                    </div>
                )}
            </section>
        </div>
    );
}

export default function CompositionTab({ data, user, reloadKey }: { data: RosterDetail; user: SessionUser | null; reloadKey: number }) {
    const t = useT();
    const state = useApi(() => getRosterComposition(data.roster.id), [data.roster.id, reloadKey]);
    return (
        <AsyncView state={state} loading={<RaidLoader compact text={t("roster.comp.loading")} />} error={(e) => <p className="rn-empty">{errorText(e)}</p>}>
            {(comp) => <Composition comp={comp} data={data} user={user} />}
        </AsyncView>
    );
}
