// Steps 3 and 4 · Vorläufig and Roster (/kader/<id>/roster): one grid of four
// equal columns — Roster (two columns wide), Bench and Tentative on top, the
// provisional roster (all four columns) below — so every card has the width of
// one column and the same height. All four sections look alike; only a small
// coloured line says which state they are. One card for all: spec icon and
// name in the class colour, votes and comments on the right; below it the
// decision (roster) or the wishes as numbered spec icons. The drawer of the
// chosen player on the right: wishes, the attendance over the Kader's raid
// categories, the interview, the leads' votes, comments, the decision (a spec
// from the wishes, WishPicker) with Ins Roster /
// Entscheidung ändern, Bench, Tentative and the step back; the history behind
// the "Verlauf" button in its head. Somebody else on the same player shows as a
// marker on the card and a calm line in the drawer; a refetch keeps a
// half-typed comment and a picked spec.
// Cards move by drag and drop or with the drawer's buttons; every move can go
// back. ?spieler=<id> opens the drawer (on a phone it slides over the page).
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addKaderComment, deleteKaderComment, setKaderState, setKaderVote, type KaderEntry, type KaderState, type KaderVote, type KaderWish } from "../../api";
import { Button, IconButton, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { BenchIcon, CheckIcon, CommentIcon, EditIcon, SendIcon, TentativeIcon, XIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useT } from "../../i18n";
import { relativeDayLabel } from "../../lib/format";
import { rolePluralLabel } from "../../lib/wow/wowNames";
import { canMove, classColor, dayOf, entriesIn, mainPick, nameOf, playerName, ROLES, roleCounts, wishLabel, wishOptions } from "../../lib/kader/model";
import { classColorProps } from "../../components/character/ClassSpec";
import { leadHue } from "../../lib/kader/leads";
import { LeadBadge } from "./Leads";
import { dragProps, useDropZone } from "./dnd";
import {
    AnswerLines, BackButton, Count, PickIcon, PickLabel, PlayerName, RoleIcon, StateIcon, VoteIcon, WishIcons, WishLines,
} from "./parts";
import { AttendanceLine } from "./Attendance";
import WishPicker from "./WishPicker";
import { useKader, useReportFocus } from "./kaderContext";
import { HistoryButton } from "./ActivityLog";
import { PresenceBanner, PresenceMark } from "./Presence";

/** The sections in grid order: the decided states on top, the provisional roster below. */
const SECTIONS: KaderState[] = ["roster", "bench", "tentative", "provisional"];
const COLUMNS: KaderState[] = ["provisional", "roster", "bench", "tentative"];
const VOTES: KaderVote[] = ["yes", "unsure", "no"];

/** One player, the same card in every section. */
function Card({ userId, entry, current, onPick }: { userId: string; entry: KaderEntry; current: boolean; onPick: () => void }) {
    const t = useT();
    const { view, players, canWrite } = useKader();
    const pick = mainPick(players.get(userId), entry);
    const votes = Object.values(entry.votes);
    const yes = votes.filter((v) => v === "yes").length;
    const no = votes.filter((v) => v === "no").length;
    const name = playerName(view, userId, entry);
    const color = classColorProps(classColor(view.classes, pick ? pick.className : ""));
    return (
        <button type="button" className={`kp-card${current ? " kp-current" : ""}`} aria-pressed={current} onClick={onPick} {...dragProps(userId, canWrite)}>
            <span className="kp-card-top">
                <PickIcon pick={pick} size={22} />
                <span className={`kp-card-name${color.className ? ` ${color.className}` : ""}`} style={color.style}>{name}</span>
                <PresenceMark playerId={userId} />
                <span className="kp-card-meta">
                    <span className="kp-cnt kp-yes" data-tip={t("kader.decide.yesVotes", { count: yes })}><CheckIcon /><span className="kp-mono" aria-hidden="true">{yes}</span><span className="kp-sr">{t("kader.decide.yesVotes", { count: yes })}</span></span>
                    {no > 0 && <span className="kp-cnt kp-no" data-tip={t("kader.decide.noVotes", { count: no })}><XIcon /><span className="kp-mono" aria-hidden="true">{no}</span><span className="kp-sr">{t("kader.decide.noVotes", { count: no })}</span></span>}
                    <span className="kp-cnt" data-tip={t("kader.decide.commentCount", { count: entry.comments.length })}><CommentIcon /><span className="kp-mono" aria-hidden="true">{entry.comments.length}</span><span className="kp-sr">{t("kader.decide.commentCount", { count: entry.comments.length })}</span></span>
                </span>
            </span>
            <span className="kp-card-sub">
                {entry.state === "roster" && entry.decision
                    ? <><PickIcon pick={entry.decision} size={16} /><PickLabel pick={entry.decision} className="kp-ellipsis" /></>
                    : <WishIcons wishes={entry.wishes} size={16} />}
            </span>
        </button>
    );
}

/** One state: the same panel for all four, a coloured line on top says which. */
function Section({ state, current, onPick, onDropUser }: { state: KaderState; current: string; onPick: (userId: string) => void; onDropUser: (userId: string, to: KaderState) => void }) {
    const t = useT();
    const { view, kader, canWrite } = useKader();
    const rows = entriesIn(kader, [state]).sort(([a, ea], [b, eb]) => playerName(view, a, ea).localeCompare(playerName(view, b, eb)));
    const drop = useDropZone((userId) => onDropUser(userId, state), canWrite);
    const mix = state === "roster" ? roleCounts(view.classes, rows.map(([, e]) => e.decision || e.wishes[0] || null)) : null;
    return (
        <section className={`kp-stcol kp-stcol-${state}${drop.over ? " kp-over" : ""}`} aria-label={t(`kader.state.${state}`)} {...drop.props}>
            <div className="kp-stcol-head">
                <StateIcon state={state} />
                <h3 className="kp-stcol-title">{t(`kader.state.${state}`)}</h3>
                <Count n={rows.length} tip={t(`kader.nav.count.${state}`, { count: rows.length })} />
                {mix && (
                    <span className="kp-rolemix">
                        {ROLES.map((r) => <span key={r} data-tip={t("kader.roleCount", { role: rolePluralLabel(r), n: mix[r] })}><RoleIcon role={r} size={16} /><b className="kp-mono">{mix[r]}</b></span>)}
                    </span>
                )}
            </div>
            <div className="kp-cards">
                {rows.map(([id, e]) => <Card key={id} userId={id} entry={e} current={id === current} onPick={() => onPick(id)} />)}
                {rows.length === 0 && (
                    <div className="kp-card kp-card-empty" aria-hidden="true">
                        <StateIcon state={state} />
                        <span>{canWrite ? t("kader.decide.dropHere") : t("kader.decide.emptyRead")}</span>
                    </div>
                )}
            </div>
        </section>
    );
}

function Drawer({ userId, entry, onClose }: { userId: string; entry: KaderEntry; onClose: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, canWrite, isLead, me, run } = useKader();
    useReportFocus("view", { playerId: userId, what: "drawer", edit: false });
    const options = wishOptions(entry);
    // the spec picked here; until somebody picks one it follows the stored decision (also one changed live)
    const [pickedSpec, setPickedSpec] = useState<string | null>(null);
    const choice = pickedSpec !== null ? pickedSpec : (entry.decision || entry.wishes[0] || { spec: "" }).spec;
    // a half-typed comment stays when the entry changes live (the drawer is keyed by the player only)
    const [text, setText] = useState("");
    const name = playerName(view, userId, entry);
    const iv = entry.interview;
    const mine = entry.votes[me] || "";
    const picked = options.find((o) => o.pick.spec === choice) || null;
    const same = !!entry.decision && entry.decision.spec === choice;

    const moveTo = async (to: KaderState, decision?: KaderWish) => {
        if (await run(setKaderState(kader.id, [userId], to, decision))) {
            setPickedSpec(null);
            toast(to === "roster" && decision ? t("kader.decide.toRosterDone", { name, pick: wishLabel(view.classes, decision) }) : t("kader.decide.moved", { name, state: t(`kader.state.${to}`) }));
        }
    };
    const vote = (v: KaderVote) => void run(setKaderVote(kader.id, userId, v === mine ? "" : v));
    const send = async () => {
        const clean = text.trim();
        if (!clean) return;
        if (await run(addKaderComment(kader.id, userId, clean))) setText("");
    };
    const removeComment = async (commentId: string) => {
        if (!(await ask({ title: t("kader.decide.deleteCommentTitle"), action: t("common.delete"), tone: "danger" }))) return;
        await run(deleteKaderComment(kader.id, userId, commentId));
    };
    const back: KaderState = entry.state === "provisional" ? "selected" : "provisional";
    const leadIndex = (id: string) => leadHue(kader.leads, id);

    return (
        <aside className="kp-drawer" aria-label={t("kader.decide.drawer", { name })}>
            <div className="kp-drawer-head">
                <div className="kp-col kp-grow">
                    <span className="kp-drawer-kicker"><StateIcon state={entry.state} /><span className="kicker">{t(`kader.decide.kicker.${entry.state}`)}</span></span>
                    <h2><PlayerName userId={userId} entry={entry} /></h2>
                </div>
                <HistoryButton userId={userId} entry={entry} />
                <IconButton icon={<XIcon />} size="sm" tip={t("common.close")} onClick={onClose} />
            </div>
            <PresenceBanner playerId={userId} what="drawer" />
            <WishLines wishes={entry.wishes} />
            <AttendanceLine userId={userId} label={t("kader.pool.attendance")} />
            <details className="kp-details">
                <summary className="kp-ivsummary">
                    <span>{iv.completedAt ? t("kader.decide.interviewDone") : t("kader.decide.interviewOpen")}</span>
                    {(iv.lead || iv.completedAt) && <LeadBadge userId={iv.lead || iv.completedBy} />}
                    {iv.completedAt && <span className="kp-muted">{dayOf(iv.completedAt)}</span>}
                </summary>
                <AnswerLines entry={entry} questions={kader.questions} />
                {iv.note && <p className="kp-quote">{t("kader.quote", { text: iv.note })}</p>}
                <Link className="kp-link" to={`/kader/${kader.id}/vorauswahl?spieler=${encodeURIComponent(userId)}`}>{t("kader.decide.openInterview")}</Link>
            </details>
            <div className="kp-block">
                <span className="kicker">{t("kader.decide.votes")}</span>
                <div className="kp-votes">
                    {Object.keys(entry.votes).length === 0 && <span className="kp-muted">{t("kader.decide.noVoteYet")}</span>}
                    {Object.entries(entry.votes).map(([by, v]) => (
                        <span key={by} className={`kp-vote kp-vote-${v}`}><VoteIcon vote={v} />{nameOf(view, by)} · {t(`kader.vote.${v}`)}</span>
                    ))}
                </div>
                {canWrite && isLead && (
                    <Segment<KaderVote | ""> size="sm" ariaLabel={t("kader.decide.myVote")} value={mine} onChange={(v) => { if (v) vote(v); }}
                        options={VOTES.map((v) => ({ value: v, label: t(`kader.vote.${v}Action`), icon: <VoteIcon vote={v} /> }))} />
                )}
                {canWrite && isLead && mine && <BackButton size="sm" label={t("kader.decide.takeBack")} onClick={() => vote(mine)} />}
                {canWrite && !isLead && <span className="kp-hint">{t("kader.decide.onlyLeads")}</span>}
            </div>
            <div className="kp-block kp-comments">
                <span className="kicker">{t("kader.decide.commentsTitle", { n: entry.comments.length })}</span>
                {entry.comments.map((c) => (
                    <div key={c.id} className="kp-comment">
                        <div className="kp-comment-head">
                            <b className={`kp-author kp-hue-${leadIndex(c.by)}`}>{nameOf(view, c.by)}</b>
                            <span className="kp-muted">· {relativeDayLabel(Math.floor(Date.parse(c.at) / 1000))}</span>
                            <span className="kp-grow" />
                            {canWrite && c.by === me && <IconButton icon={<XIcon />} size="sm" tip={t("kader.decide.deleteComment")} onClick={() => void removeComment(c.id)} />}
                        </div>
                        <p>{c.text}</p>
                    </div>
                ))}
                {canWrite && (
                    <form className="kp-commentform" onSubmit={(e) => { e.preventDefault(); void send(); }}>
                        <input type="text" maxLength={1000} aria-label={t("kader.decide.comment")} placeholder={t("kader.decide.commentPlaceholder")} value={text} onChange={(e) => setText(e.target.value)} />
                        <Button size="sm" type="submit" icon={<SendIcon />} disabled={!text.trim()}>{t("kader.decide.send")}</Button>
                    </form>
                )}
            </div>
            {canWrite && (
                <div className="kp-block kp-decision">
                    <span className="kicker">{t("kader.decide.decision")}</span>
                    {options.length
                        ? <WishPicker entry={entry} value={choice} wide label={t("kader.decide.decisionAria")} onChange={(pick) => setPickedSpec(pick.spec)} />
                        : <span className="kp-hint">{t("kader.interview.noWishes")}</span>}
                    {entry.state === "roster" ? (
                        <Button className="kp-wide" icon={<EditIcon />} disabled={!picked || same} onClick={() => void moveTo("roster", picked ? picked.pick : undefined)}>
                            {t("kader.decide.changeDecision")}
                        </Button>
                    ) : (
                        <Button className="kp-wide" icon={<CheckIcon />} disabled={!picked} onClick={() => void moveTo("roster", picked ? picked.pick : undefined)}>
                            {t("kader.decide.toRoster")}
                        </Button>
                    )}
                    <div className="kp-moves">
                        {(["bench", "tentative"] as const).map((s) => {
                            const here = entry.state === s;
                            return (
                                <Button key={s} variant="ghost" className={here ? "kp-here" : undefined} icon={s === "bench" ? <BenchIcon /> : <TentativeIcon />}
                                    disabled={here} aria-pressed={here} onClick={() => void moveTo(s)}>
                                    {t(`kader.state.${s}`)}
                                </Button>
                            );
                        })}
                    </div>
                    {canMove(entry.state, back) && <BackButton wide label={t(`kader.decide.back.${back}`)} onClick={() => void moveTo(back)} />}
                </div>
            )}
        </aside>
    );
}

export default function DecisionView() {
    const t = useT();
    const toast = useToast();
    const { view, kader, run } = useKader();
    const [params, setParams] = useSearchParams();
    const wanted = params.get("spieler") || "";
    const entry = wanted ? kader.players[wanted] : undefined;
    const current = entry && COLUMNS.includes(entry.state) ? wanted : "";
    const pick = (userId: string) => setParams(userId && userId !== current ? { spieler: userId } : {}, { replace: true });

    const dropOn = async (userId: string, to: KaderState) => {
        const e = kader.players[userId];
        if (!e || e.state === to) return;
        if (!canMove(e.state, to)) {
            toast(t("kader.decide.cantMove"), "err");
            return;
        }
        if (await run(setKaderState(kader.id, [userId], to))) toast(t("kader.decide.moved", { name: playerName(view, userId, e), state: t(`kader.state.${to}`) }));
    };

    return (
        <div className="kp-view">
            {!current && <p className="kp-hint">{t("kader.decide.pickHint")}</p>}
            <div className={`kp-decide${current ? " kp-open" : ""}`}>
                <div className="kp-decide-main">
                    <div className="kp-sections">
                        {SECTIONS.map((s) => <Section key={s} state={s} current={current} onPick={pick} onDropUser={(id, to) => void dropOn(id, to)} />)}
                    </div>
                </div>
                {current && entry && <Drawer key={current} userId={current} entry={entry} onClose={() => pick("")} />}
            </div>
        </div>
    );
}
