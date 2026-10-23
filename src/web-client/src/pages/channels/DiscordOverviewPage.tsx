import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getDiscordOverview, type BotMessage, type DiscordOverview, type DiscordSide, type MemberActivity, type SessionUser } from "../../api";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, Button, PageHead, Segment, buttonClass } from "../../components/ui";
import { SortTh } from "../../components/ui/SortTh";
import { CheckIcon, ChevronRightIcon, ExternalIcon, RefreshIcon } from "../../components/ui/icons";
import DiscordTabs from "../../components/channels/DiscordTabs";
import RaidLoader from "../../components/ui/RaidLoader";
import { useTableSort } from "../../lib/ui/tableSort";
import { formatDateTime } from "../../lib/format";
import {
    attentionItems, botCheckRank, botCheckRows, functionState, hygieneLine, mayOpenHref, messageKindLabel,
    messageStatus, refreshWait, uncheckedLine, type AttentionItem, type BotCheckRow,
} from "../../lib/discord/overview";
import "../../styles/discord-overview.css";
import { useT } from "../../i18n";

// System › Discord › Übersicht (docs/channels.md): the start page of the Discord
// area. One main element — what needs attention on the chosen server, each point
// with its status word, why, and a button to where it is fixed; "Alles in
// Ordnung" when nothing is open. Below it who joined or left in the last seven
// days, the bot's fixed messages, and the bot check: every function against the
// rights it needs, event and talk server side by side. "Neu prüfen" asks Discord
// again for the fixed messages, at most every 30 seconds. Display only.

const REFRESH_GAP_MS = 30000;
/** Joins and leaves shown before "Alle zeigen". */
const MEMBERS_SHOWN = 8;

type MsgSort = "kind" | "channel" | "status";
const MSG_SORT: Record<MsgSort, "asc" | "desc"> = { kind: "asc", channel: "asc", status: "asc" };
type FnSort = "fn" | "state";
const FN_SORT: Record<FnSort, "asc" | "desc"> = { fn: "asc", state: "asc" };

export default function DiscordOverviewPage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const [side, setSide] = useState<DiscordSide>("event");
    // Each server keeps its own answer: switching shows what is already there and
    // asks nothing again. A side loads once it is chosen, or (for the bot check
    // side by side) once the chosen one answered with its bot online; after that
    // it stays loaded.
    const [wanted, setWanted] = useState<Record<DiscordSide, boolean>>({ event: true, talk: false });
    // "Neu prüfen" asks Discord afresh only for the side it was clicked on
    const fresh = useRef<Record<DiscordSide, boolean>>({ event: false, talk: false });
    const [lastFresh, setLastFresh] = useState<Record<DiscordSide, number>>({ event: 0, talk: 0 });
    const [now, setNow] = useState(() => Date.now());
    const states = {
        event: useApi(() => getDiscordOverview("event", fresh.current.event), [], { enabled: wanted.event }),
        talk: useApi(() => getDiscordOverview("talk", fresh.current.talk), [], { enabled: wanted.talk }),
    };
    const otherSide: DiscordSide = side === "event" ? "talk" : "event";
    const state = states[side];
    const data = state.data;
    const otherData = states[otherSide].data;
    const online = !!(data && data.online);
    useEffect(() => {
        if (online) setWanted((w) => (w[otherSide] ? w : { ...w, [otherSide]: true }));
    }, [online, otherSide]);
    const choose = (next: DiscordSide) => {
        setSide(next);
        setWanted((w) => (w[next] ? w : { ...w, [next]: true }));
    };

    const wait = refreshWait(lastFresh[side], now, REFRESH_GAP_MS);
    // tick while the button waits, so its countdown moves
    useEffect(() => {
        if (!wait) return undefined;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [wait]);

    const refresh = () => {
        const at = Date.now();
        if (refreshWait(lastFresh[side], at, REFRESH_GAP_MS)) return;
        const clicked = side;
        setLastFresh((l) => ({ ...l, [clicked]: at }));
        setNow(at);
        fresh.current[clicked] = true;
        states[clicked].reload().finally(() => { fresh.current[clicked] = false; });
    };

    const controls = (
        <div className="dov-controls">
            <Segment<DiscordSide>
                ariaLabel={t("discord.roles.page.server")}
                value={side}
                onChange={choose}
                options={[
                    { value: "event", label: t("discord.roles.side.event") },
                    { value: "talk", label: t("discord.roles.side.talk") },
                ]}
            />
            <Button
                variant="ghost" size="sm" icon={<RefreshIcon />} onClick={refresh}
                disabled={wait > 0 || state.loading || !data || !data.guildId || !data.online}
                data-tip={t("discord.overview.refreshTip")} data-tip-sub={t("discord.overview.refreshSub")}
            >
                {wait > 0 ? t("discord.overview.refreshWait", { count: wait }) : t("discord.overview.refresh")}
            </Button>
        </div>
    );

    const eventData = side === "event" ? data : otherData;
    const talkData = side === "talk" ? data : otherData;

    return (
        <div className="dov-page">
            <PageHead
                icon="inv_misc_spyglass_02" tone="channels"
                kicker={t("discord.overview.kicker")}
                title={t("discord.overview.title")}
                meta={data && data.guildId && !data.online
                    ? <Badge tone="bad" tip={t("discord.overview.offline")} tipSub={t("discord.overview.offlineSub")}>{t("discord.overview.offline")}</Badge>
                    : undefined}
            />
            <DiscordTabs user={user} side={side} guildKey={data ? data.guildId : ""} />
            {controls}

            {state.error && !data && <p className="empty">{t("discord.overview.loadError", { message: state.error.message })}</p>}
            {!data && !state.error && <RaidLoader text={t("discord.overview.loading")} />}
            {data && !data.guildId && <p className="empty">{t(side === "event" ? "discord.roles.page.eventMissing" : "discord.roles.page.talkMissing")}</p>}
            {data && data.guildId && !data.online && <p className="empty">{t("discord.overview.offlineSub")}</p>}
            {data && data.guildId && data.online && (
                <>
                    <Attention data={data} user={user} />
                    <div className="dov-cols">
                        <Members members={data.members} user={user} />
                        <Messages messages={data.messages} />
                    </div>
                    <BotCheck rows={botCheckRows(eventData, talkData && talkData.guildId ? talkData : null)} showTalk={!!(talkData && talkData.guildId)} />
                </>
            )}
        </div>
    );
}

/** A section heading with its count in words beside it. */
function SectionHead({ id, title, note }: { id?: string; title: string; note?: ReactNode }) {
    return (
        <div className="dov-head" id={id}>
            <h2>{title}</h2>
            {note && <span className="dov-note">{note}</span>}
        </div>
    );
}

function Attention({ data, user }: { data: DiscordOverview; user: SessionUser | null }) {
    const t = useT();
    const items = attentionItems(data, user);
    const hygiene = hygieneLine(data.hygiene);
    // messages the bot could not read are no point to fix: one calm line, like the hygiene
    const unchecked = data.botCheck.known ? uncheckedLine(data.messages) : "";
    return (
        <section className="dov-attention" aria-labelledby="dov-attention-h">
            <div className="dov-head">
                <h2 id="dov-attention-h">{t("discord.overview.attention.title")}</h2>
                {items.length > 0 && <span className="dov-note">{t("discord.overview.attention.count", { count: items.length })}</span>}
            </div>
            {items.length === 0 ? (
                <p className="dov-allgood"><CheckIcon /> {t("discord.overview.attention.allGood")}</p>
            ) : (
                <ul className="dov-att-list">
                    {items.map((item) => <AttentionRow key={item.id} item={item} />)}
                </ul>
            )}
            {unchecked && <p className="dov-hygiene">{unchecked}</p>}
            {hygiene && <p className="dov-hygiene">{hygiene}</p>}
        </section>
    );
}

function AttentionRow({ item }: { item: AttentionItem }) {
    const action = item.action;
    const cls = buttonClass("ghost", "sm", true, "dov-att-btn");
    return (
        <li className={`dov-att dov-tone-${item.tone}`}>
            <span className="dov-att-status">{item.status}</span>
            <span className="dov-att-text">
                <span className="dov-att-what">{item.what}</span>
                {item.why && <span className="dov-att-why">{item.why}</span>}
            </span>
            {action && (action.to.startsWith("#") ? (
                <button type="button" className={cls} onClick={() => document.getElementById(action.to.slice(1))?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>
                    <ChevronRightIcon />{action.label}
                </button>
            ) : (
                <Link to={action.to} className={cls}><ChevronRightIcon />{action.label}</Link>
            ))}
        </li>
    );
}

function relationText(m: MemberActivity, t: ReturnType<typeof useT>): string {
    const rosters = m.relation.rosters.map((r) => r.name);
    if (rosters.length) return rosters.join(", ");
    if (m.relation.characters > 0) return t("discord.overview.members.characters", { count: m.relation.characters });
    return t("discord.overview.members.noRelation");
}

function Members({ members, user }: { members: MemberActivity[]; user: SessionUser | null }) {
    const t = useT();
    const [all, setAll] = useState(false);
    const joins = members.filter((m) => m.kind === "join").length;
    const leaves = members.length - joins;
    const shown = all ? members : members.slice(0, MEMBERS_SHOWN);
    const linked = mayOpenHref(user, "/channels/members");
    return (
        <section className="dov-members">
            <SectionHead
                title={t("discord.overview.members.title")}
                note={members.length ? `${t("discord.overview.members.joins", { count: joins })} · ${t("discord.overview.members.leaves", { count: leaves })}` : undefined}
            />
            {members.length === 0 ? <p className="dov-empty">{t("discord.overview.members.empty")}</p> : (
                <ul className="dov-mem-list">
                    {shown.map((m) => (
                        <li key={`${m.kind}-${m.userId}-${m.at}`} className="dov-mem">
                            <span className={`dov-mem-kind dov-mem-${m.kind}`}>{t(`discord.overview.members.${m.kind}`)}</span>
                            <span className="dov-mem-main">
                                {linked
                                    ? <Link className="dov-mem-name" to={`/channels/members?user=${encodeURIComponent(m.userId)}`}>{m.name || m.userId}</Link>
                                    : <span className="dov-mem-name">{m.name || m.userId}</span>}
                                <span className={`dov-mem-rel${m.relation.rosters.length ? "" : " dov-muted"}`}>{relationText(m, t)}</span>
                            </span>
                            <span className="dov-mem-at">{formatDateTime(m.at)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {members.length > MEMBERS_SHOWN && (
                <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>
                    {all ? t("discord.overview.members.less") : t("discord.overview.members.all", { count: members.length })}
                </Button>
            )}
        </section>
    );
}

function Messages({ messages }: { messages: BotMessage[] }) {
    const t = useT();
    const sort = useTableSort<MsgSort>("discord-overview-msg-sort", MSG_SORT, "status");
    const rows = sort.apply(messages, (m, key) => {
        if (key === "kind") return `${messageKindLabel(m)} ${m.title || m.categoryName}`.toLowerCase();
        if (key === "channel") return (m.channelName || "").toLowerCase();
        return messageStatus(m).rank;
    });
    return (
        <section className="dov-messages">
            <SectionHead title={t("discord.overview.messages.title")} note={messages.length ? t("discord.overview.messages.count", { count: messages.length }) : undefined} />
            {messages.length === 0 ? <p className="dov-empty">{t("discord.overview.messages.empty")}</p> : (
                <table className="idx dov-msg-table">
                    <thead>
                        <tr>
                            <SortTh sortKey="kind" label={t("discord.overview.messages.kind")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                            <SortTh sortKey="channel" label={t("discord.overview.messages.channel")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                            <SortTh sortKey="status" label={t("discord.overview.messages.status")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((m) => {
                            const st = messageStatus(m);
                            const extra = m.title || m.categoryName;
                            return (
                                <tr key={`${m.kind}-${m.messageId || m.channelId || m.categoryId}`}>
                                    <td>
                                        <span className="dov-msg-kind">{messageKindLabel(m)}</span>
                                        {extra && <span className="dov-msg-extra">{extra}</span>}
                                    </td>
                                    <td className="dov-msg-channel">{m.channelName ? `#${m.channelName}` : <span className="dov-muted">–</span>}</td>
                                    <td className="dov-msg-status">
                                        <span className={`dov-st-${st.tone}`}>{st.text}</span>
                                        {m.link && (
                                            <a
                                                className="dov-msg-link" href={m.link} target="_blank" rel="noreferrer"
                                                aria-label={t("discord.overview.messages.open")} data-tip={t("discord.overview.messages.open")}
                                            >
                                                <ExternalIcon />
                                            </a>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function StateCell({ row, side, label }: { row: BotCheckRow; side: "event" | "talk"; label: string }) {
    const st = functionState(row[side]);
    return (
        <td className="dov-fn-state" data-label={label}>
            <span className={`dov-st-${st.tone}`}>{st.text}</span>
            {st.missing.length > 0 && <span className="dov-fn-missing">{st.missing.join(", ")}</span>}
        </td>
    );
}

function BotCheck({ rows, showTalk }: { rows: BotCheckRow[]; showTalk: boolean }) {
    const t = useT();
    const sort = useTableSort<FnSort>("discord-overview-fn-sort", FN_SORT, "state");
    const sorted = sort.apply(rows, (r, key) => (key === "fn" ? r.label.toLowerCase() : botCheckRank(r)));
    const eventLabel = t("discord.roles.side.event");
    const talkLabel = t("discord.roles.side.talk");
    // on a phone the fine functions fold into one line, the problems stay in view (CSS decides by width)
    const [open, setOpen] = useState(false);
    const okCount = rows.filter((r) => botCheckRank(r) >= 2).length;
    return (
        <section className="dov-botcheck">
            <SectionHead id="bot-check" title={t("discord.overview.botCheck.title")} note={t("discord.overview.botCheck.note")} />
            {rows.length === 0 ? <p className="dov-empty">{t("discord.overview.botCheck.empty")}</p> : (
                <table className={`idx dov-fn-table${showTalk ? " dov-fn-two" : ""}${open ? " dov-fn-open" : ""}`}>
                    <thead>
                        <tr>
                            <SortTh sortKey="fn" label={t("discord.overview.botCheck.fn")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                            <th>{t("discord.overview.botCheck.rights")}</th>
                            <SortTh sortKey="state" label={eventLabel} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("discord.overview.botCheck.stateTip")} />
                            {showTalk && <th>{talkLabel}</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((r) => (
                            <tr key={r.key} className={botCheckRank(r) >= 2 ? "dov-fn-okrow" : undefined}>
                                <td className="dov-fn-name">{r.label}</td>
                                <td className="dov-fn-rights" data-label={t("discord.overview.botCheck.rights")}>
                                    {r.rights.length ? r.rights.map((x) => x.label).join(", ") : <span className="dov-muted">–</span>}
                                </td>
                                <StateCell row={r} side="event" label={eventLabel} />
                                {showTalk && <StateCell row={r} side="talk" label={talkLabel} />}
                            </tr>
                        ))}
                        {okCount > 0 && (
                            <tr className="dov-fn-fold">
                                <td colSpan={showTalk ? 4 : 3}>
                                    <Button variant="ghost" size="sm" icon={<ChevronRightIcon />} aria-expanded={open} onClick={() => setOpen(!open)}>
                                        {t("discord.overview.botCheck.okFold", { count: okCount })}
                                    </Button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            )}
        </section>
    );
}
