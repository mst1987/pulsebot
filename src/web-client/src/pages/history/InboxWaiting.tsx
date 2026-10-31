// The Addon-Inbox's "Wartet auf Zuordnung" and "Verworfen" lists (#1002).
//
// An upload with a game version looks for its raid among the raids of that day
// on the upload key's servers (same version, matching realm). When one raid holds
// at least 60 % of its participants, it is filed there by itself; otherwise it
// lands here, for the orga of every server that has a candidate. Each candidate
// names its server and how many of the upload's participants were signed up;
// the best one is marked "Vorschlag". Whoever assigns first decides: the other
// server sees the upload vanish, a late click answers 409.
//
// Lists and dividers rather than cards (canvas of #1002): an upload is a head
// line and its candidate rows, a date column of 140 px, 640 px wide at most.
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    acceptLootInbox, assignInboxBank, dismissLootInbox, restoreLootInbox,
    type ApiError, type InboxCandidate, type InboxDismissedSession, type InboxWaitingBank, type InboxWaitingSession,
} from "../../api";
import type { ShellContext } from "../../components/shell/Shell";
import { useConfirm } from "../../components/ui/overlay/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { CheckIcon, RefreshIcon, TrashIcon } from "../../components/ui/icons/icons";
import { useContentVersion } from "../../hooks/useContentVersion";
import { formatDateTime, formatEventTime } from "../../lib/format";
import { tParts, useT } from "../../i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 14;

/**
 * "TBC" for "tbc": the server's short name (versionHead, as the sync app shows it, #1001),
 * else the version's label as the top bar shows it.
 */
function useVersionLabel(): (id?: string, short?: string) => string {
    const { versions } = useContentVersion();
    return (id, short) => {
        if (short) return short;
        if (!id) return "";
        const v = versions.find((x) => x.id === id);
        return v ? (v.short || v.label) : id.toUpperCase();
    };
}

/** "TBC · Thunderstrike · 6 Items · von Gemli" — the muted line under an upload's title. */
function MetaLine({ parts }: { parts: string[] }) {
    return <div className="hl-wait-meta">{parts.filter(Boolean).join(" · ")}</div>;
}

/** Number of distinct servers an upload or bank waits for, for the foot line. */
function serverCount(ids: string[]): number {
    return new Set(ids.filter(Boolean)).size;
}

function FootNote({ servers }: { servers: number }) {
    const t = useT();
    return <p className="hl-wait-foot">{servers === 2 ? t("history.waiting.footTwo") : t("history.waiting.footMany", { count: servers })}</p>;
}

/** One candidate raid: when, which server and raid, how many participants; the button if we may assign it. */
function CandidateRow({ c, busy, onAssign }: { c: InboxCandidate; busy: boolean; onAssign: () => void }) {
    const t = useT();
    const server = c.serverName || t("history.waiting.unknownServer");
    return (
        <div className={`hl-wait-row${c.suggested ? " is-best" : ""}`}>
            <span className="hl-wait-when mono">{formatEventTime(c.startTime)}</span>
            <span className="hl-wait-what">
                <b>{c.eventLabel}</b>
                <small>
                    {[server, c.categoryName].filter(Boolean).join(" · ")}
                    {" · "}
                    <span className="hl-wait-count">{t("history.waiting.participants", { matched: c.matched, count: c.total })}</span>
                </small>
            </span>
            {c.suggested && <Badge tone="ok" tip={t("history.waiting.suggestedTip")}>{t("history.waiting.suggested")}</Badge>}
            {c.assignable
                // Short label: the raid name already stands in the row; the full text is the tooltip and name.
                ? <Button variant="go" size="sm" icon={<CheckIcon />} disabled={busy} onClick={onAssign}
                    aria-label={t("history.waiting.assign", { raid: c.eventLabel })}
                    data-tip={t("history.waiting.assign", { raid: c.eventLabel })}>{t("history.waiting.assignShort")}</Button>
                : <span className="hl-wait-other" data-tip={t("history.waiting.otherServerTip", { server })}>{t("history.waiting.otherServer", { server })}</span>}
        </div>
    );
}

export function WaitingUpload({ session, onDone }: { session: InboxWaitingSession; onDone: (msg: string, error?: boolean) => void }) {
    const t = useT();
    const ask = useConfirm();
    const versionLabel = useVersionLabel();
    const [busy, setBusy] = useState(false);
    const title = session.contentLabel || session.instance || t("history.shared.unknownRaid");

    // Another server was faster: tell it plainly and reload, the upload is gone.
    const failText = (err: unknown) => {
        const e = err as ApiError;
        if (e.code === "already_assigned") return t("history.waiting.taken");
        if (e.code === "already_dismissed") return t("history.waiting.dismissedMeanwhile");
        // A raid of another server (full admins only) deleted since the upload, or without a category there.
        if (e.code === "event_gone") return t("history.waiting.eventGone");
        if (e.code === "no_category") return t("history.waiting.noCategory");
        return e.message;
    };

    const assign = async (c: InboxCandidate) => {
        setBusy(true);
        try {
            const r = await acceptLootInbox({ id: session.id, event: c.eventId });
            onDone(t("history.inboxCard.accepted", { count: r.added, event: r.eventLabel }));
        } catch (err) {
            onDone(failText(err), true);
            setBusy(false);
        }
    };

    const dismiss = async () => {
        if (!(await ask({ title: t("history.inboxCard.dismissTitle"), text: t("history.waiting.dismissText", { title, days: KEEP_DAYS }), action: t("common.discard") }))) return;
        setBusy(true);
        try {
            await dismissLootInbox(session.id);
            onDone(t("history.inboxCard.dismissed"));
        } catch (err) {
            onDone(failText(err), true);
            setBusy(false);
        }
    };

    return (
        <section className="hl-wait" aria-label={title}>
            <div className="hl-wait-head">
                <div className="hl-wait-title">
                    <b>{title}</b>
                    <span className="hl-wait-recv">{t("history.waiting.received", { date: formatDateTime(session.receivedAt) })}</span>
                </div>
                <MetaLine parts={[
                    versionLabel(session.gameVersion, session.versionShort), session.realm,
                    t("history.waiting.items", { count: session.itemCount }),
                    session.reporter ? t("history.waiting.from", { name: session.reporter }) : "",
                ]} />
            </div>
            {session.candidates.map((c) => (
                <CandidateRow key={c.eventId} c={c} busy={busy} onAssign={() => assign(c)} />
            ))}
            {!session.candidates.length && <div className="hl-wait-row muted">{t("history.waiting.noCandidates")}</div>}
            <div className="hl-wait-actions">
                <Button variant="danger" size="sm" icon={<TrashIcon />} disabled={busy} onClick={dismiss}>{t("common.discard")}</Button>
            </div>
        </section>
    );
}

export function DismissedUpload({ session, onDone }: { session: InboxDismissedSession; onDone: (msg: string, error?: boolean) => void }) {
    const t = useT();
    const versionLabel = useVersionLabel();
    const [busy, setBusy] = useState(false);
    const title = session.contentLabel || session.instance || t("history.shared.unknownRaid");
    const daysLeft = Math.max(0, Math.ceil((session.dismissedAt + KEEP_DAYS * DAY_MS - Date.now()) / DAY_MS));

    const restore = async () => {
        setBusy(true);
        try {
            await restoreLootInbox(session.id);
            onDone(t("history.waiting.restored"));
        } catch (err) {
            onDone((err as ApiError).message, true);
            setBusy(false);
        }
    };

    return (
        <div className="hl-wait-row hl-dismissed">
            <span className="hl-wait-when mono">{formatDateTime(session.dismissedAt)}</span>
            <span className="hl-wait-what">
                <b>{title}</b>
                <small>{[
                    versionLabel(session.gameVersion, session.versionShort), session.realm,
                    t("history.waiting.items", { count: session.itemCount }),
                    session.dismissedBy ? t("history.waiting.dismissedBy", { name: session.dismissedBy }) : "",
                ].filter(Boolean).join(" · ")}</small>
            </span>
            <span className="hl-wait-other" data-tip={t("history.waiting.daysLeftTip")}>{t("history.waiting.daysLeft", { count: daysLeft })}</span>
            <Button variant="yes" size="sm" icon={<RefreshIcon />} disabled={busy} onClick={restore}>{t("history.waiting.restore")}</Button>
        </div>
    );
}

export function WaitingBank({ bank, onDone }: { bank: InboxWaitingBank; onDone: (msg: string, error?: boolean) => void }) {
    const t = useT();
    const versionLabel = useVersionLabel();
    const ctx = useOutletContext<ShellContext | undefined>();
    // A full admin may give the bank to any of its servers; everybody else to the active one.
    const fullAdmin = !!ctx?.user?.isAdmin;
    const [busy, setBusy] = useState(false);

    const assign = async (guildId: string, name: string) => {
        setBusy(true);
        try {
            await assignInboxBank(bank.key, guildId);
            onDone(t("history.waiting.bankAssigned", { guild: bank.guild, server: name }));
        } catch (err) {
            const e = err as ApiError;
            onDone(e.code === "already_assigned" ? t("history.waiting.bankTaken") : e.message, true);
            setBusy(false);
        }
    };

    return (
        <section className="hl-wait" aria-label={bank.guild}>
            <div className="hl-wait-head">
                <div className="hl-wait-title">
                    <b>{t("history.waiting.bankTitle", { guild: bank.guild })}</b>
                    <span className="hl-wait-recv">{t("history.waiting.received", { date: formatDateTime(bank.receivedAt) })}</span>
                </div>
                <MetaLine parts={[
                    versionLabel(bank.gameVersion, bank.versionShort), bank.realm,
                    t("history.waiting.items", { count: bank.items }),
                    bank.uploadedBy ? t("history.waiting.from", { name: bank.uploadedBy }) : "",
                ]} />
            </div>
            {bank.servers.map((s) => {
                const server = s.name || t("history.waiting.unknownServer");
                return (
                    <div className="hl-wait-row" key={s.guildId}>
                        <span className="hl-wait-when">{t("history.waiting.server")}</span>
                        <span className="hl-wait-what"><b>{server}</b>{s.ownServer && <small>{t("history.waiting.thisServer")}</small>}</span>
                        {(s.ownServer || fullAdmin)
                            ? <Button variant="go" size="sm" icon={<CheckIcon />} disabled={busy} onClick={() => assign(s.guildId, server)}>{t("history.waiting.bankAssign", { server })}</Button>
                            : <span className="hl-wait-other">{t("history.waiting.otherServer", { server })}</span>}
                    </div>
                );
            })}
        </section>
    );
}

/** The whole "Wartet auf Zuordnung" tab: uploads first, then guild banks; one foot line. */
export function WaitingList({ waiting, banks, onDone }: {
    waiting: InboxWaitingSession[];
    banks: InboxWaitingBank[];
    onDone: (msg: string, error?: boolean) => void;
}) {
    const t = useT();
    if (!waiting.length && !banks.length) return <div className="empty hl-wait-empty">{t("history.waiting.empty")}</div>;
    const servers = Math.max(
        2,
        ...waiting.map((s) => serverCount(s.servers.length ? s.servers : s.candidates.map((c) => c.guildId))),
        ...banks.map((b) => serverCount(b.servers.map((s) => s.guildId))),
    );
    return (
        <div className="hl-wait-list">
            {waiting.map((s) => <WaitingUpload key={s.id} session={s} onDone={onDone} />)}
            {banks.map((b) => <WaitingBank key={b.key} bank={b} onDone={onDone} />)}
            <FootNote servers={servers} />
        </div>
    );
}

/** The "Verworfen" tab: the last 14 days, each with "Wiederherstellen". */
export function DismissedList({ dismissed, onDone }: { dismissed: InboxDismissedSession[]; onDone: (msg: string, error?: boolean) => void }) {
    const t = useT();
    if (!dismissed.length) return <div className="empty hl-wait-empty">{t("history.waiting.dismissedEmpty")}</div>;
    return (
        <div className="hl-wait-list">
            <div className="hl-wait hl-wait-flat">
                {dismissed.map((s) => <DismissedUpload key={s.id} session={s} onDone={onDone} />)}
            </div>
            <p className="hl-wait-foot">{tParts("history.waiting.dismissedFoot", { count: KEEP_DAYS })}</p>
        </div>
    );
}
