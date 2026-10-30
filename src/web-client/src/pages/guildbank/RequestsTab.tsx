// The "Anfragen" tab of the guild bank (#633): the bank's requests from the
// stock that still wait — first the set-aside ones ("Vorgemerkt": confirmed,
// waiting for the hand-out in game), then the open ones (waiting for the orga,
// who confirm or decline on the card in the guild bank's orga channel in
// Discord). Read only, like the card is the place to decide; the one step here
// is linking: a request whose character is no character of its raider's
// profile ("nicht verknüpft") cannot be confirmed — "Verknüpfen" picks the
// profile character (CharacterPicker.tsx in a dialog), the server redraws the
// card and "Bestätigen" works. A linked one can be linked anew. A name without
// a profile to pick (a raider without a Discord account, #806) gets "Im Spiel
// geprüft" for the name itself above the search.
// The requests are loaded by the page once (GuildBankPage.tsx): the tab's
// count and the "Vorgemerkt" popover of the item list read the same answer.
import { useEffect, useMemo, useState } from "react";
import { linkGuildBankRequest, reassignGuildBankRequest, verifyGuildBankRequest, type ApiError, type GuildBankCharacterChoice, type GuildBankItem, type GuildBankRequest } from "../../api";
import { Badge, Button, IconButton, Modal, WowIcon } from "../../components/ui";
import { LinkIcon } from "../../components/ui/icons/icons";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useToast } from "../../components/shell/Jobs";
import type { UseApi } from "../../hooks/useApi";
import { formatDateTime } from "../../lib/format";
import { refreshWowheadLinks } from "../../lib/wow/wowheadTooltips";
import { useT } from "../../i18n";
import { agoLabel, filterRequests, groupRequestsByStatus, profileNote, recipientName } from "./bankView";
import { CharacterPicker, LinkIntro, NotLinkedBadge, type NamePick } from "./CharacterPicker";

export type RequestsList = UseApi<{ requests: GuildBankRequest[] }>;

function RequestRow({ request, item, canWrite, onLink }: { request: GuildBankRequest; item: GuildBankItem | undefined; canWrite: boolean; onLink: (r: GuildBankRequest) => void }) {
    const t = useT();
    const to = recipientName(request);
    const confirmed = request.status === "confirmed";
    const what = t("guildbank.requests.amountItem", { amount: request.amount, item: request.item });
    return (
        <li className={`gb-out-row gb-reqrow${request.linked ? "" : " gb-req-unlinked"}`}>
            <ItemIcon url={request.iconUrl} quality={item ? item.quality : null} />
            <div className="gb-req-text">
                <span className="gb-out-what">{what}</span>
                <span className="gb-out-to">
                    <span className="gb-out-label">{t("guildbank.handedOut.to")}</span>
                    <b>{to || request.userName || "–"}</b>
                </span>
                <span className="gb-req-sub">
                    {[
                        request.userName && request.userName !== request.characterName ? t("guildbank.link.raider", { name: request.userName }) : "",
                        request.purpose ? t("guildbank.requests.purpose", { purpose: request.purpose }) : "",
                    ].filter(Boolean).join(" · ")}
                </span>
                {!request.linked && (
                    <span className="gb-req-link">
                        <NotLinkedBadge noRaider={!request.userId} problem={request.linkProblem} />
                        {canWrite && (
                            <Button size="sm" variant="ghost" icon={<LinkIcon />} onClick={() => onLink(request)} aria-label={`${t("guildbank.link.button")}: ${what}`}>
                                {t("guildbank.link.button")}
                            </Button>
                        )}
                    </span>
                )}
            </div>
            <div className="gb-out-meta">
                <span className="gb-out-time" data-tip={formatDateTime(request.createdAt)}>{t("guildbank.requests.since", { when: agoLabel(request.createdAt) })}</span>
                <span className="gb-out-how">
                    {request.fromWaitlist && <Badge size="sm" tip={t("guildbank.handedOut.fromWaitlistTip")}>{t("guildbank.handedOut.fromWaitlist")}</Badge>}
                </span>
                {confirmed && request.handledByName && (
                    <span className="gb-req-sub" data-tip={formatDateTime(request.handledAt)}>
                        {t("guildbank.requests.reservedBy", { name: request.handledByName, when: agoLabel(request.handledAt) })}
                    </span>
                )}
                {request.linked && canWrite && (
                    <IconButton icon={<LinkIcon />} size="sm" tip={t("guildbank.link.relink")} tipSub={t("guildbank.link.relinkTip", { name: to })}
                        aria-label={`${t("guildbank.link.relink")}: ${what}`} onClick={() => onLink(request)} />
                )}
            </div>
        </li>
    );
}

export default function RequestsTab({ bankKey, list, items, canWrite = false, category, search, onChanged }: {
    bankKey: string;
    list: RequestsList;
    /** The bank's items: the category per request, the item quality. */
    items: GuildBankItem[];
    canWrite?: boolean;
    category: string;
    search: string;
    /** A request was linked: the page reads its numbers again. */
    onChanged?: () => void;
}) {
    const t = useT();
    const toast = useToast();
    const [linking, setLinking] = useState<GuildBankRequest | null>(null);
    const [busy, setBusy] = useState(false);
    const all = useMemo(() => list.data?.requests || [], [list.data]);
    const byId = useMemo(() => new Map(items.map((it) => [it.itemId, it])), [items]);
    const groups = useMemo(() => groupRequestsByStatus(filterRequests(all, byId, { category, search })), [all, byId, category, search]);
    const unlinked = all.filter((r) => !r.linked).length;
    useEffect(() => { refreshWowheadLinks(); }, [groups]);

    const replace = (request: GuildBankRequest) => list.setData((d) => (d ? { requests: d.requests.map((x) => (x.id === request.id ? request : x)) } : d));

    const done = (request: GuildBankRequest, message: string) => {
        replace(request);
        toast(message, "ok");
        setLinking(null);
        onChanged?.();
    };

    const link = async (request: GuildBankRequest, choice: GuildBankCharacterChoice) => {
        setBusy(true);
        try {
            const r = await linkGuildBankRequest(bankKey, request.id, { userId: choice.userId, characterKey: choice.characterKey });
            done(r.request, t("guildbank.link.done", { name: recipientName(choice), raider: choice.userName }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    // "Im Spiel geprüft" for the request's own name (#806): linked without a profile
    const verify = async (request: GuildBankRequest) => {
        setBusy(true);
        try {
            const r = await verifyGuildBankRequest(bankKey, request.id);
            done(r.request, t("guildbank.link.currentChecked", { name: recipientName(request) }));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    // #809: another character name, known or checked in game; the raider stays
    const takeName = async (request: GuildBankRequest, pick: NamePick) => {
        setBusy(true);
        try {
            const r = await reassignGuildBankRequest(bankKey, request.id, pick);
            done(r.request, [t("guildbank.link.taken", { name: recipientName(r.request) }), profileNote(r.profile, request.userName)].filter(Boolean).join(" "));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="gb-out-tab">
            <div className="gb-out-top">
                <p className="gb-hint">{t("guildbank.requests.hint")}</p>
            </div>
            {unlinked > 0 && <div className="flash flash-warn">{t("guildbank.requests.unlinked", { count: unlinked })}</div>}
            {list.error && !list.data && <div className="empty">{list.error.message}</div>}
            {!list.data && !list.error && <div className="empty">{t("guildbank.requests.loading")}</div>}
            {list.data && !all.length && <div className="empty">{t("guildbank.requests.empty")}</div>}
            {list.data && all.length > 0 && !groups.length && <div className="empty">{t("guildbank.waitlist.noMatch")}</div>}
            <div className="gb-wl-groups">
                {groups.map((g) => (
                    <section key={g.status} className="gb-wl-group" aria-label={t(`guildbank.requests.group.${g.status}`)}>
                        <header className="gb-wl-head">
                            <span className="gb-wl-item">{t(`guildbank.requests.group.${g.status}`)}</span>
                            <span className="gb-req-sub">{t(`guildbank.requests.groupSub.${g.status}`)}</span>
                            <Badge size="sm">{t("guildbank.requests.count", { count: g.requests.length })}</Badge>
                        </header>
                        <ul className="gb-wl-list">
                            {g.requests.map((r) => <RequestRow key={r.id} request={r} item={byId.get(r.itemId)} canWrite={canWrite} onLink={setLinking} />)}
                        </ul>
                    </section>
                ))}
            </div>

            {linking && (
                <Modal
                    open
                    onClose={() => setLinking(null)}
                    icon={<WowIcon name="guildbank" size={22} />}
                    tone="bank"
                    kicker={t("guildbank.tabsDialog.kicker")}
                    title={t("guildbank.link.title")}
                    width={600}
                    footer={<Button variant="ghost" onClick={() => setLinking(null)}>{t("guildbank.waitlist.back")}</Button>}
                >
                    <CharacterPicker
                        bankKey={bankKey}
                        initialQuery={linking.characterName || linking.userName}
                        busy={busy}
                        onPick={(choice) => { void link(linking, choice); }}
                        onTakeName={(pick) => { void takeName(linking, pick); }}
                        raiderName={linking.userId ? linking.userName || linking.userId : undefined}
                        intro={<LinkIntro what={t("guildbank.requests.amountItem", { amount: linking.amount, item: linking.item })} current={recipientName(linking)} busy={busy}
                            onVerify={!linking.linked && linking.characterName ? () => { void verify(linking); } : undefined} />}
                    />
                </Modal>
            )}
        </div>
    );
}
