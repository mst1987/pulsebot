// Steps 3 and 4 · Vorläufig and Roster (/kader/<id>/roster): four columns —
// Vorläufig (the leads discuss), Roster, Bench, Tentative — and the drawer of the
// chosen player: the wishes, the interview, the leads' votes, comments, the
// decision (which class and spec in the roster) and what happened so far. Cards
// move by drag and drop or with the drawer's buttons; every move can go back.
// ?spieler=<id> opens the drawer (on a phone it slides over the page).
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addKaderComment, deleteKaderComment, setKaderState, setKaderVote, type KaderEntry, type KaderState, type KaderVote, type KaderWish } from "../../api";
import { Button, IconButton, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { CheckIcon, XIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { relativeDayLabel } from "../../lib/format";
import { rolePluralLabel } from "../../lib/wowNames";
import { canMove, dayOf, entriesIn, mainPick, nameOf, playerName, ROLES, roleCounts, specName, wishLabel } from "../../lib/kader/model";
import { dragProps, useDropZone } from "./dnd";
import { AnswerLines, CommentIcon, HistoryLines, PickIcon, PlayerName, RoleIcon, StateSince, WishLines } from "./parts";
import { useKader } from "./kaderContext";

const COLUMNS: KaderState[] = ["provisional", "roster", "bench", "tentative"];
const VOTES: KaderVote[] = ["yes", "unsure", "no"];

function Card({ userId, entry, current, onPick }: { userId: string; entry: KaderEntry; current: boolean; onPick: () => void }) {
    const t = useT();
    const { view, players, canWrite } = useKader();
    const yes = Object.values(entry.votes).filter((v) => v === "yes").length;
    const sub = entry.state === "provisional"
        ? entry.wishes.slice(0, 2).map((w, i) => `${i + 1}. ${specName(view.classes, w.spec)}`).join(" · ")
        : specName(view.classes, (entry.decision || entry.wishes[0] || { spec: "" }).spec);
    return (
        <button type="button" className={`kp-card${current ? " kp-current" : ""}`} aria-pressed={current} onClick={onPick} {...dragProps(userId, canWrite)}>
            <span className="kp-card-top">
                <PickIcon pick={mainPick(players.get(userId), entry)} size={22} />
                <span className="kp-grow kp-strong kp-ellipsis">{playerName(view, userId, entry)}</span>
                {entry.state === "provisional" && (
                    <>
                        <span className="kp-cnt kp-yes" data-tip={t("kader.decide.yesVotes", { n: yes })}><CheckIcon /><span className="kp-mono">{yes}</span></span>
                        <span className="kp-cnt" data-tip={t("kader.decide.commentCount", { n: entry.comments.length })}><CommentIcon /><span className="kp-mono">{entry.comments.length}</span></span>
                    </>
                )}
            </span>
            <span className="kp-card-sub">{sub || t("kader.interview.noWishes")}</span>
        </button>
    );
}

function Column({ state, current, onPick, onDropUser }: { state: KaderState; current: string; onPick: (userId: string) => void; onDropUser: (userId: string, to: KaderState) => void }) {
    const t = useT();
    const { view, kader, canWrite } = useKader();
    const rows = entriesIn(kader, [state]).sort(([a, ea], [b, eb]) => playerName(view, a, ea).localeCompare(playerName(view, b, eb)));
    const drop = useDropZone((userId) => onDropUser(userId, state), canWrite);
    const mix = state === "roster" ? roleCounts(view.classes, rows.map(([, e]) => e.decision || e.wishes[0] || null)) : null;
    return (
        <section className={`kp-stcol kp-stcol-${state}${drop.over ? " kp-over" : ""}`} aria-label={t(`kader.state.${state}`)} {...drop.props}>
            <div className="kp-between">
                <h3 className="kp-stcol-title">{t(`kader.state.${state}`)}</h3>
                <span className="kp-mono kp-muted">{rows.length}</span>
            </div>
            {mix && (
                <div className="kp-rolemix">
                    {ROLES.map((r) => <span key={r} data-tip={rolePluralLabel(r)}><RoleIcon role={r} size={16} /><b className="kp-mono">{mix[r]}</b></span>)}
                </div>
            )}
            {rows.length === 0 && <p className="kp-hint">{t(`kader.decide.empty.${state}`)}</p>}
            {rows.map(([id, e]) => <Card key={id} userId={id} entry={e} current={id === current} onPick={() => onPick(id)} />)}
        </section>
    );
}

/** The class/spec a player would stand for in the roster: the wishes, and a decision that is none of them. */
function choicesOf(entry: KaderEntry): { pick: KaderWish; rank: number }[] {
    const out = entry.wishes.map((w, i) => ({ pick: w, rank: i + 1 }));
    if (entry.decision && !entry.wishes.some((w) => w.spec === entry.decision?.spec)) out.unshift({ pick: entry.decision, rank: 0 });
    return out;
}

function Drawer({ userId, entry, onClose }: { userId: string; entry: KaderEntry; onClose: () => void }) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, canWrite, isLead, me, run } = useKader();
    const choices = choicesOf(entry);
    const [choice, setChoice] = useState((entry.decision || entry.wishes[0] || { spec: "" }).spec);
    const [text, setText] = useState("");
    const name = playerName(view, userId, entry);
    const iv = entry.interview;
    const mine = entry.votes[me] || "";
    const picked = choices.find((c) => c.pick.spec === choice);

    const moveTo = async (to: KaderState, decision?: KaderWish) => {
        if (await run(setKaderState(kader.id, [userId], to, decision))) {
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
    const leadIndex = (id: string) => Math.max(0, kader.leads.indexOf(id)) % 4;

    return (
        <aside className="kp-drawer" aria-label={t("kader.decide.drawer", { name })}>
            <div className="kp-drawer-head">
                <div className="kp-col kp-grow">
                    <span className="kicker">{t(`kader.decide.kicker.${entry.state}`)}</span>
                    <h2><PlayerName userId={userId} entry={entry} /></h2>
                    <span className="kp-sub"><StateSince entry={entry} /></span>
                </div>
                <IconButton icon={<XIcon />} size="sm" tip={t("common.close")} onClick={onClose} />
            </div>
            <WishLines wishes={entry.wishes} />
            <details className="kp-details">
                <summary>{iv.completedAt ? t("kader.decide.interviewBy", { lead: nameOf(view, iv.lead || iv.completedBy), date: dayOf(iv.completedAt) }) : t("kader.decide.interviewOpen")}</summary>
                <AnswerLines entry={entry} questions={kader.questions} />
                {iv.note && <p className="kp-quote">{t("kader.quote", { text: iv.note })}</p>}
                <Link className="kp-link" to={`/kader/${kader.id}/vorauswahl?spieler=${encodeURIComponent(userId)}`}>{t("kader.decide.openInterview")}</Link>
            </details>
            <div className="kp-block">
                <span className="kicker">{t("kader.decide.votes")}</span>
                <div className="kp-votes">
                    {Object.keys(entry.votes).length === 0 && <span className="kp-muted">{t("kader.decide.noVotes")}</span>}
                    {Object.entries(entry.votes).map(([by, v]) => <span key={by} className={`kp-vote kp-vote-${v}`}>{nameOf(view, by)} · {t(`kader.vote.${v}`)}</span>)}
                </div>
                {canWrite && isLead && (
                    <Segment<KaderVote | ""> size="sm" ariaLabel={t("kader.decide.myVote")} value={mine} onChange={(v) => { if (v) vote(v); }}
                        options={VOTES.map((v) => ({ value: v, label: t(`kader.vote.${v}Action`) }))} />
                )}
                {canWrite && isLead && mine && <button type="button" className="kp-link kp-quiet kp-start" onClick={() => vote(mine)}>{t("kader.decide.takeBack")}</button>}
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
                        <Button size="sm" type="submit" disabled={!text.trim()}>{t("kader.decide.send")}</Button>
                    </form>
                )}
            </div>
            {canWrite && (
                <div className="kp-block kp-decision">
                    <span className="kicker">{t("kader.decide.decision")}</span>
                    <div className="kp-pickrow">
                        <PickIcon pick={picked ? picked.pick : null} size={30} />
                        <select aria-label={t("kader.decide.decisionAria")} value={choice} disabled={!choices.length} onChange={(e) => setChoice(e.target.value)}>
                            {!choices.length && <option value="">{t("kader.interview.noWishes")}</option>}
                            {choices.map((c) => (
                                <option key={c.pick.spec} value={c.pick.spec}>
                                    {c.rank ? t("kader.decide.wishN", { label: wishLabel(view.classes, c.pick), n: c.rank }) : t("kader.decide.current", { label: wishLabel(view.classes, c.pick) })}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="kp-moves">
                        {entry.state !== "roster" && <Button disabled={!picked} onClick={() => void moveTo("roster", picked ? picked.pick : undefined)}>{t("kader.decide.toRoster")}</Button>}
                        {entry.state === "roster" && (
                            <Button variant="ghost" disabled={!picked || (!!entry.decision && entry.decision.spec === choice)} onClick={() => void moveTo("roster", picked ? picked.pick : undefined)}>
                                {t("kader.decide.changeDecision")}
                            </Button>
                        )}
                        {(["bench", "tentative"] as KaderState[]).filter((s) => s !== entry.state).map((s) => (
                            <Button key={s} variant="ghost" onClick={() => void moveTo(s)}>{t(`kader.state.${s}`)}</Button>
                        ))}
                    </div>
                    {canMove(entry.state, back) && <button type="button" className="kp-link kp-quiet kp-start" onClick={() => void moveTo(back)}>{t(`kader.decide.back.${back}`)}</button>}
                </div>
            )}
            <details className="kp-details">
                <summary>{t("kader.decide.history")}</summary>
                <HistoryLines entry={entry} />
            </details>
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
            <div className={`kp-decide${current ? " kp-open" : ""}`}>
                {COLUMNS.map((s) => <Column key={s} state={s} current={current} onPick={pick} onDropUser={(id, to) => void dropOn(id, to)} />)}
                {current && entry ? <Drawer key={`${current}-${entry.state}`} userId={current} entry={entry} onClose={() => pick("")} /> : (
                    <aside className="kp-drawer kp-drawer-empty">
                        <p className="kp-hint">{t("kader.decide.pickHint")}</p>
                    </aside>
                )}
            </div>
        </div>
    );
}
