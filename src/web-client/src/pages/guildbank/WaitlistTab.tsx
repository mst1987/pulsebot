// The "Warteliste" tab of the guild bank (#775), next to "Ausgebbar": every
// offered item has one list per bank — whoever asked first is served first,
// in turns: when stock comes free, the first move up on their own as open
// requests (card in the orga channel, DM), each at most the item's portion
// ("reihum je 2" in the item's head); a rest stands in line again at the
// end. The tab lists the queues per item: place,
// raider or character, amount, since when; forward / back / remove for the
// orga. Adding one entry and the sheet import are dialogs of their own
// (WaitlistAddDialog.tsx, WaitlistImportDialog.tsx) opened from the filter
// line; this tab reads the list again when they are done (`reloadToken`).
// An entry whose character is no character of its raider's profile is marked
// "nicht verknüpft", one whose profile character nobody has confirmed (no log,
// loot, armory or orga check) "Charakter nicht bestätigt" — when it moves up,
// the orga cannot confirm it until it is linked (or the character confirmed): "Verknüpfen" opens the character search (CharacterPicker.tsx), a
// linked entry can be linked anew with the small chain button.
// Reading takes "raids", every change "raids" write — without it only the list.
import { useState } from "react";
import {
    getGuildBankWaitlist, linkGuildBankRequest, moveGuildBankWaiting, reassignGuildBankRequest, removeGuildBankWaiting, verifyGuildBankRequest,
    type ApiError, type GuildBankCharacterChoice, type GuildBankItem, type GuildBankWaitingEntry, type GuildBankWaitlist,
} from "../../api";
import { Badge, Button, IconButton, useConfirm } from "../../components/ui";
import { ChevronDownIcon, ChevronUpIcon, LinkIcon, TrashIcon } from "../../components/ui/icons/icons";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../i18n";
import { availableTone, filterWaitlist, groupWaitlist, profileNote, recipientName, waitingName, type WaitlistGroup } from "./bankView";
import LinkCharacterDialog, { NotLinkedBadge, type NamePick } from "./CharacterPicker";

type RowActions = {
    onMove: (entry: GuildBankWaitingEntry, direction: "up" | "down") => void;
    onRemove: (entry: GuildBankWaitingEntry) => void;
    onLink: (entry: GuildBankWaitingEntry) => void;
};

function EntryRow({ entry, first, last, canWrite, busy, onMove, onRemove, onLink }: RowActions & {
    entry: GuildBankWaitingEntry;
    first: boolean;
    last: boolean;
    canWrite: boolean;
    busy: boolean;
}) {
    const t = useT();
    const name = waitingName(entry);
    const sub = [
        // a raider's recipient character, when it is not the name shown already
        entry.characterName && entry.characterName !== name ? t("guildbank.requests.to", { name: recipientName(entry) }) : "",
        t("guildbank.waitlist.since", { date: formatDateTime(entry.createdAt) }),
        entry.addedByName ? t("guildbank.waitlist.addedBy", { name: entry.addedByName }) : "",
    ];
    return (
        <li className="gb-wl-row">
            <span className="gb-wl-place" aria-label={`#${entry.position}`}>{entry.position}</span>
            <div className="gb-req-text">
                <span className="gb-req-title">
                    {name}
                    {!entry.linked && <NotLinkedBadge noRaider={!entry.userId} problem={entry.linkProblem} />}
                    {!entry.linked && canWrite && (
                        <Button size="sm" variant="ghost" icon={<LinkIcon />} disabled={busy} onClick={() => onLink(entry)}
                            aria-label={`${t("guildbank.link.button")}: ${name}`}>
                            {t("guildbank.link.button")}
                        </Button>
                    )}
                </span>
                <span className="gb-req-sub">{sub.filter(Boolean).join(" · ")}</span>
            </div>
            <span className="gb-wl-amount">{t("guildbank.waitlist.amount", { amount: entry.amount })}</span>
            <span className="gb-wl-actions">
                {canWrite && (
                    <>
                        {entry.linked && (
                            <IconButton icon={<LinkIcon />} size="sm" tip={t("guildbank.link.relink")} tipSub={t("guildbank.link.relinkTip", { name: recipientName(entry) })}
                                aria-label={`${t("guildbank.link.relink")}: ${name}`} disabled={busy} onClick={() => onLink(entry)} />
                        )}
                        <IconButton icon={<ChevronUpIcon />} size="sm" tip={t("guildbank.waitlist.up")} aria-label={`${t("guildbank.waitlist.up")}: ${name}`}
                            disabled={busy || first} onClick={() => onMove(entry, "up")} />
                        <IconButton icon={<ChevronDownIcon />} size="sm" tip={t("guildbank.waitlist.down")} aria-label={`${t("guildbank.waitlist.down")}: ${name}`}
                            disabled={busy || last} onClick={() => onMove(entry, "down")} />
                        <IconButton icon={<TrashIcon />} size="sm" tone="danger" tip={t("guildbank.waitlist.remove")} aria-label={`${t("guildbank.waitlist.remove")}: ${name}`}
                            disabled={busy} onClick={() => onRemove(entry)} />
                    </>
                )}
            </span>
        </li>
    );
}

function ItemQueue({ group, item, canWrite, busyId, ...actions }: RowActions & {
    group: WaitlistGroup;
    item: GuildBankItem | undefined;
    canWrite: boolean;
    busyId: string;
}) {
    const t = useT();
    const free = item ? item.free : 0;
    return (
        <section className="gb-wl-group" aria-label={group.item}>
            <header className="gb-wl-head">
                <ItemIcon url={group.iconUrl} quality={item ? item.quality : null} />
                <span className="gb-wl-item">{group.item}</span>
                <Badge size="sm">{t("guildbank.waitlist.entries", { count: group.entries.length })}</Badge>
                <Badge size="sm" tone={availableTone(free)}>{t("guildbank.waitlist.free", { count: free })}</Badge>
                {item && item.portion > 0 && (
                    <Badge size="sm" tip={t("guildbank.waitlist.portionTip", { count: item.portion })}>{t("guildbank.waitlist.portion", { count: item.portion })}</Badge>
                )}
            </header>
            <ol className="gb-wl-list">
                {group.entries.map((e, i) => (
                    <EntryRow key={e.id} entry={e} first={i === 0} last={i === group.entries.length - 1}
                        canWrite={canWrite} busy={busyId === e.id} {...actions} />
                ))}
            </ol>
        </section>
    );
}

export default function WaitlistTab({ bankKey, items, canWrite, category, search, reloadToken, onChanged }: {
    bankKey: string;
    /** The bank's items: "Verfügbar" and the category per queue. */
    items: GuildBankItem[];
    canWrite: boolean;
    category: string;
    search: string;
    /** Counts up whenever a dialog added entries: the list is read again. */
    reloadToken: number;
    /** An entry moved or left: the page reads the item numbers again. */
    onChanged: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const list = useApi(() => getGuildBankWaitlist(bankKey), [bankKey, reloadToken]);
    const [busyId, setBusyId] = useState("");
    const [linking, setLinking] = useState<GuildBankWaitingEntry | null>(null);
    const entries = list.data?.entries || [];
    const byId = new Map(items.map((it) => [it.itemId, it]));
    const groups = groupWaitlist(filterWaitlist(entries, byId, { category, search }));

    const step = async (entry: GuildBankWaitingEntry, fn: () => Promise<GuildBankWaitlist>) => {
        setBusyId(entry.id);
        try {
            const r = await fn();
            list.setData({ entries: r.entries });
            onChanged();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };
    const move = (entry: GuildBankWaitingEntry, direction: "up" | "down") => { void step(entry, () => moveGuildBankWaiting(bankKey, entry.id, direction)); };
    // the entry's raider and character become the picked profile character; the list is read again
    const link = async (entry: GuildBankWaitingEntry, choice: GuildBankCharacterChoice) => {
        setBusyId(entry.id);
        try {
            await linkGuildBankRequest(bankKey, entry.id, { userId: choice.userId, characterKey: choice.characterKey });
            toast(t("guildbank.link.done", { name: recipientName(choice), raider: choice.userName }), "ok");
            setLinking(null);
            await list.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };
    // "Im Spiel geprüft" for the entry's own name (#806): linked without a raider profile
    const verify = async (entry: GuildBankWaitingEntry) => {
        setBusyId(entry.id);
        try {
            await verifyGuildBankRequest(bankKey, entry.id);
            toast(t("guildbank.link.currentChecked", { name: recipientName(entry) }), "ok");
            setLinking(null);
            await list.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };
    // #809: another character name — known, or checked in game — the raider stays
    const takeName = async (entry: GuildBankWaitingEntry, pick: NamePick) => {
        setBusyId(entry.id);
        try {
            const r = await reassignGuildBankRequest(bankKey, entry.id, pick);
            toast([t("guildbank.link.taken", { name: recipientName(r.request) }), profileNote(r.profile, entry.userName)].filter(Boolean).join(" "), "ok");
            setLinking(null);
            await list.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyId("");
        }
    };
    const remove = async (entry: GuildBankWaitingEntry) => {
        const ok = await ask({
            title: t("guildbank.waitlist.removeTitle"),
            text: t("guildbank.waitlist.removeText", { amount: entry.amount, item: entry.item, name: waitingName(entry) }),
            action: t("guildbank.waitlist.remove"),
            tone: "danger",
        });
        if (ok) await step(entry, () => removeGuildBankWaiting(bankKey, entry.id));
    };

    return (
        <div className="gb-wl-tab">
            <p className="gb-hint">{t("guildbank.waitlist.hint")}</p>
            {list.error && !list.data && <div className="empty">{list.error.message}</div>}
            {!list.data && !list.error && <div className="empty">{t("guildbank.waitlist.loading")}</div>}
            {list.data && !entries.length && <div className="empty">{t("guildbank.waitlist.empty")}</div>}
            {list.data && entries.length > 0 && !groups.length && <div className="empty">{t("guildbank.waitlist.noMatch")}</div>}
            <div className="gb-wl-groups">
                {groups.map((g) => (
                    <ItemQueue key={g.itemId} group={g} item={byId.get(g.itemId)} canWrite={canWrite} busyId={busyId}
                        onMove={move} onRemove={(e) => { void remove(e); }} onLink={setLinking} />
                ))}
            </div>
            {linking && canWrite && (
                <LinkCharacterDialog
                    bankKey={bankKey}
                    what={t("guildbank.requests.amountItem", { amount: linking.amount, item: linking.item })}
                    current={linking.characterName || waitingName(linking)}
                    busy={busyId === linking.id}
                    onPick={(choice) => { void link(linking, choice); }}
                    onVerify={!linking.linked && linking.characterName ? () => { void verify(linking); } : undefined}
                    onTakeName={(pick) => { void takeName(linking, pick); }}
                    raiderName={linking.userId ? linking.userName || linking.userId : undefined}
                    onClose={() => setLinking(null)}
                />
            )}
        </div>
    );
}
