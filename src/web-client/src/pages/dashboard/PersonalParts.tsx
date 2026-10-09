// "Für dich" — the raider's own part of the start page (design canvas Oct 2026,
// direction A; the server side is src/web/dashboard/dashboardPersonal.js):
//
//   MyNextRaid      the next raid with the raider's signup, setup group, softres
//                   list and — from the published plan — the bosses they are
//                   personally assigned on (read like the /p/<token> view does)
//   MyRaids         the raids after it, each with the own status or "Anmelden"
//   AttendanceDots  the last nights as coloured, lettered fields
//   MyRecentRaids   the last nights with the status and that night's evaluation
//
// The orga gets MyNextRaid compact (one line of badges) above its own block.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getRaidplanPublic, type DashboardPersonal, type PersonalNight, type PersonalRaid } from "../../api";
import { PartHead } from "../../components/ui/PartHead";
import { buttonClass } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import WowIcon from "../../components/ui/WowIcon";
import { bossesWithMine } from "../../lib/raidplan/bossMine";
import { rosterMap } from "../../lib/raidplan/players";
import { sectionLabel } from "../../lib/raidplan/profiles";
import { relativeDayLabel } from "../../lib/format";
import { dayDate, raidWhen } from "../../lib/raids/overviewDates";
import { useT } from "../../i18n";

type Tone = "ok" | "mid" | "bad" | "accent" | undefined;

const STATUS_TONE: Record<string, Tone> = { signed: "ok", late: "mid", tentative: "mid", bench: undefined, absence: undefined };
const NIGHT_TONE: Record<string, Tone> = { present: "ok", bench: undefined, vacation: undefined, absence: undefined, noSignup: "mid", noShow: "bad" };

/** Where the raider signs up for one raid: the "Anmeldungen" page opened on it. */
function signupHref(eventId: string): string {
    return `/signups?event=${encodeURIComponent(eventId)}`;
}

/** Whether "Anmelden" still works for a raid without the raider's signup. */
function canSignUp(raid: PersonalRaid): boolean {
    return !raid.status && !raid.cancelled && !raid.signupsClosed && !raid.deadlinePassed && !raid.rosterOnly;
}

/** The raider's status in one coming raid as a badge, or the way to sign up. */
export function MyStatus({ raid }: { raid: PersonalRaid }) {
    const t = useT();
    if (raid.cancelled) return <Badge tone="bad">{t("dashboard.personal.status.cancelled")}</Badge>;
    if (!raid.status) {
        if (canSignUp(raid)) return <Link className={buttonClass("primary", "sm")} to={signupHref(raid.id)}>{t("dashboard.personal.signUp")}</Link>;
        return <Badge tip={t(raid.rosterOnly ? "dashboard.personal.rosterOnlyTip" : "dashboard.personal.closedTip")}>{t(raid.rosterOnly ? "dashboard.personal.rosterOnly" : "dashboard.personal.closed")}</Badge>;
    }
    const label = t(`dashboard.personal.status.${raid.status}`);
    return <Badge tone={STATUS_TONE[raid.status]}>{raid.status === "signed" && raid.spec ? `${label} · ${raid.spec}` : label}</Badge>;
}

type PlanMine = { state: "none" | "loading" | "error" | "done"; bosses: { key: string; label: string }[] };

/**
 * The bosses the raider is personally assigned on in a published plan — the
 * read view's own rule (bossMine.ts), on the read view's own payload. Loaded
 * once the card is drawn; no token, no request.
 */
function usePlanMine(token: string): PlanMine {
    const [mine, setMine] = useState<PlanMine>({ state: token ? "loading" : "none", bosses: [] });
    useEffect(() => {
        if (!token) {
            setMine({ state: "none", bosses: [] });
            return undefined;
        }
        let live = true;
        setMine({ state: "loading", bosses: [] });
        getRaidplanPublic(token)
            .then(({ data }) => {
                if (!live) return;
                const keys = bossesWithMine(data.bosses, rosterMap(data.roster), data.meIds || []);
                const several = new Set(data.bosses.map((b) => b.instanceName).filter(Boolean)).size > 1;
                setMine({ state: "done", bosses: data.bosses.filter((b) => keys.has(b.key)).map((b) => ({ key: b.key, label: sectionLabel(b, several) })) });
            })
            .catch(() => { if (live) setMine({ state: "error", bosses: [] }); });
        return () => { live = false; };
    }, [token]);
    return mine;
}

function planHref(token: string, section = ""): string {
    return `/p/${encodeURIComponent(token)}${section ? `?section=${encodeURIComponent(section)}` : ""}`;
}

/** "Deine Einteilung im Raidplan": one chip per boss the raider is assigned on, each opening that boss. */
function PlanAssignments({ token }: { token: string }) {
    const t = useT();
    const mine = usePlanMine(token);
    if (mine.state === "none") return null;
    return (
        <div className="ov-me-plan">
            <div className="ov-me-plan-hd">
                <span className="ov-area-lbl">{t("dashboard.personal.plan.title")}</span>
                <a className="ov-me-plan-all" href={planHref(token)}>{t("dashboard.personal.plan.open")}</a>
            </div>
            {mine.state === "loading" && <span className="ov-note">{t("dashboard.personal.plan.loading")}</span>}
            {mine.state === "error" && <span className="ov-note">{t("dashboard.personal.plan.error")}</span>}
            {mine.state === "done" && (mine.bosses.length
                ? (
                    <span className="ov-badges">
                        {mine.bosses.map((b) => <a key={b.key} className="badge accent ov-me-boss" href={planHref(token, b.key)}>{b.label}</a>)}
                    </span>
                )
                : <span className="ov-note">{t("dashboard.personal.plan.none")}</span>)}
        </div>
    );
}

/** One of the three fields under the next raid's title: signup, setup, softres. */
function Box({ tone, label, value, sub }: { tone?: Tone; label: string; value: string; sub?: ReactNode }) {
    return (
        <div className={`ov-me-box${tone ? ` ${tone}` : ""}`}>
            <span className="ov-area-lbl">{label}</span>
            <span className="ov-me-box-v">{value}</span>
            {sub && <span className="ov-me-box-s">{sub}</span>}
        </div>
    );
}

function setupText(raid: PersonalRaid, t: ReturnType<typeof useT>): string {
    if (!raid.placement) return t("dashboard.personal.setup.none");
    return raid.placement.bench ? t("dashboard.personal.setup.bench") : t("dashboard.personal.setup.group", { group: raid.placement.group || 0 });
}

/** "Dein nächster Raid" — in full for a raider, one line of badges above the orga block. */
export function MyNextRaid({ raid, compact = false }: { raid: PersonalRaid | null; compact?: boolean }) {
    const t = useT();
    const head = (
        <PartHead
            icon={raid ? raid.icon : "inv_misc_note_02"} tone="signups" title={t("dashboard.personal.next.title")}
            crumb={raid ? relativeDayLabel(raid.startTime) : undefined}
            action={raid && <Link className={buttonClass("ghost", "sm")} to={signupHref(raid.id)}>{t("dashboard.personal.next.toSignup")}</Link>}
        />
    );
    if (!raid) {
        return (
            <section className="dash-card ov-card">
                {head}
                <div className="ov-empty-text">{t("dashboard.personal.next.empty")}</div>
            </section>
        );
    }
    if (compact) {
        return (
            <section className="dash-card ov-card">
                {head}
                <div className="ov-me-line">
                    <span className="ov-me-line-t">{raid.title}</span>
                    <MyStatus raid={raid} />
                    {raid.placement && <Badge>{setupText(raid, t)}</Badge>}
                    {raid.softresUrl && <a className="badge" href={raid.softresUrl} target="_blank" rel="noreferrer">{t("dashboard.personal.softres.open")}</a>}
                </div>
                {raid.planToken && <div className="ov-me-compact-plan"><PlanAssignments token={raid.planToken} /></div>}
            </section>
        );
    }
    const signed = raid.status && raid.status !== "absence";
    return (
        <section className="dash-card ov-card">
            {head}
            <div className="ov-next">
                <div className="ov-next-top">
                    <WowIcon name={raid.icon} size={56} className="ov-boss56" />
                    <div className="ov-next-text">
                        {raid.categoryName && <span className="ov-cat">{raid.categoryName}</span>}
                        <span className="ov-next-title">{raid.title}</span>
                        <div className="ov-next-when">{raidWhen(raid.startTime)}</div>
                    </div>
                    {raid.cancelled && <Badge tone="bad">{t("dashboard.personal.status.cancelled")}</Badge>}
                </div>
                <div className="ov-me-boxes">
                    <Box
                        tone={raid.status ? STATUS_TONE[raid.status] : "accent"}
                        label={t("dashboard.personal.box.signup")}
                        value={raid.status ? t(`dashboard.personal.status.${raid.status}`) : t("dashboard.personal.box.notYet")}
                        sub={raid.status
                            ? [raid.character, raid.spec].filter(Boolean).join(" · ")
                            : canSignUp(raid) ? <Link to={signupHref(raid.id)}>{t("dashboard.personal.signUp")}</Link> : null}
                    />
                    <Box label={t("dashboard.personal.box.setup")} value={setupText(raid, t)} sub={signed && !raid.placement ? t("dashboard.personal.setup.noneSub") : undefined} />
                    <Box
                        label={t("dashboard.personal.box.softres")}
                        value={raid.softresUrl ? t("dashboard.personal.softres.ready") : t("dashboard.personal.softres.none")}
                        sub={raid.softresUrl ? <a href={raid.softresUrl} target="_blank" rel="noreferrer">{t("dashboard.personal.softres.open")}</a> : undefined}
                    />
                </div>
                {raid.planToken && <PlanAssignments token={raid.planToken} />}
            </div>
        </section>
    );
}

/** "Deine nächsten Raids": the raids after the next one, each with the own status. */
export function MyRaids({ raids }: { raids: PersonalRaid[] }) {
    const t = useT();
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_book_09" tone="signups" title={t("dashboard.personal.list.title")}
                action={<Link className={buttonClass("ghost", "sm")} to="/signups">{t("dashboard.personal.list.all")}</Link>}
            />
            {raids.length === 0
                ? <div className="ov-empty-text">{t("dashboard.personal.list.empty")}</div>
                : (
                    <div className="ov-rows">
                        {raids.map((r) => {
                            const deadline = !r.status && r.deadline && !r.deadlinePassed ? t("dashboard.personal.list.deadline", { when: dayDate(r.deadline * 1000) }) : "";
                            return (
                                <div key={r.id} className={`ov-row${canSignUp(r) ? " ov-row-open" : ""}`}>
                                    <WowIcon name={r.icon} size={36} className="ov-ico36" />
                                    <span className="grow">
                                        <span className="t1">{r.title}</span>
                                        <span className="t2">{[r.categoryName, dayDate(r.startTime * 1000), deadline].filter(Boolean).join(" · ")}</span>
                                    </span>
                                    <MyStatus raid={r} />
                                </div>
                            );
                        })}
                    </div>
                )}
        </section>
    );
}

const LETTER_STATUS = ["present", "bench", "vacation", "absence", "noSignup", "noShow"];

/** The last nights as fields: colour and letter per status (the attendance grid's), newest on the right. */
export function AttendanceDots({ nights }: { nights: NonNullable<DashboardPersonal["attendance"]>["last"] }) {
    const t = useT();
    return (
        <span className="ov-dots">
            {nights.slice().reverse().map((n) => {
                const status = LETTER_STATUS.includes(n.status) ? n.status : "noSignup";
                return (
                    <span
                        key={`${n.eventId}-${n.startTime}`} className={`ov-dot att-${status.toLowerCase()}`}
                        data-tip={`${n.title} · ${dayDate(n.startTime * 1000)}`} data-tip-sub={t(`attendance.status.${status}`)}
                    >{t(`attendance.letter.${status}`)}</span>
                );
            })}
        </span>
    );
}

/** That night's evaluation as the raider sees it: their hints, "alles gut", or just the report. */
function ReportBadge({ report }: { report: PersonalNight["report"] }) {
    const t = useT();
    if (!report) return <Badge>{t("dashboard.personal.recent.noReport")}</Badge>;
    if (report.hints === null) return <a className="badge" href={report.url}>{t("dashboard.personal.recent.report")}</a>;
    return report.hints > 0
        ? <a className="badge mid" href={report.url}>{t("dashboard.personal.recent.hints", { count: report.hints })}</a>
        : <a className="badge ok" href={report.url}>{t("dashboard.personal.recent.allGood")}</a>;
}

/** "Deine letzten Raids": status and evaluation of the raider's last nights. */
export function MyRecentRaids({ recent }: { recent: PersonalNight[] }) {
    const t = useT();
    return (
        <section className="dash-card ov-card">
            <PartHead
                icon="inv_misc_pocketwatch_01" tone="absences" title={t("dashboard.personal.recent.title")}
                action={<Link className={buttonClass("ghost", "sm")} to="/absences">{t("dashboard.personal.recent.attendance")}</Link>}
            />
            {recent.length === 0
                ? <div className="ov-empty-text">{t("dashboard.personal.recent.empty")}</div>
                : (
                    <div className="ov-rows">
                        {recent.map((n) => (
                            <div key={`${n.eventId}-${n.startTime}`} className="ov-row">
                                <WowIcon name={n.icon} size={36} className="ov-ico36" />
                                <span className="grow">
                                    <span className="t1">{n.title}</span>
                                    <span className="t2">{[n.categoryName, dayDate(n.startTime * 1000)].filter(Boolean).join(" · ")}</span>
                                </span>
                                <Badge tone={NIGHT_TONE[n.status]}>{t(`attendance.status.${LETTER_STATUS.includes(n.status) ? n.status : "noSignup"}`)}</Badge>
                                <ReportBadge report={n.report} />
                            </div>
                        ))}
                    </div>
                )}
        </section>
    );
}
