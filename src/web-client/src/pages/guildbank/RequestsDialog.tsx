// "Anfragen" (#633): the bank's requests from the stock that still wait — open
// ones for the orga (confirmed or declined in Discord, in the guild bank's orga
// channel) and confirmed ones waiting for the hand-out in game. The decisions
// stay on the Discord card, where the raider gets the DM; the one step here is
// linking: a request whose character is no character of its raider's profile
// ("nicht verknüpft") cannot be confirmed — "Verknüpfen" picks the profile
// character (CharacterPicker.tsx, in this dialog instead of a second one), the
// server redraws the card and "Bestätigen" works. A linked one can be linked anew.
import { useState } from "react";
import { getGuildBankRequests, linkGuildBankRequest, type ApiError, type GuildBankCharacterChoice, type GuildBankRequest } from "../../api";
import { Badge, Button, IconButton, Modal, WowIcon } from "../../components/ui";
import { LinkIcon } from "../../components/ui/icons";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../i18n";
import { REQUESTS_ICON, recipientName } from "./bankView";
import { CharacterPicker, LinkIntro, NotLinkedBadge } from "./CharacterPicker";

function RequestRow({ request, canWrite, onLink }: { request: GuildBankRequest; canWrite: boolean; onLink: (r: GuildBankRequest) => void }) {
    const t = useT();
    const to = recipientName(request);
    const confirmed = request.status === "confirmed";
    const what = t("guildbank.requests.amountItem", { amount: request.amount, item: request.item });
    return (
        <li className={`gb-req${request.linked ? "" : " gb-req-unlinked"}`}>
            <ItemIcon url={request.iconUrl} />
            <div className="gb-req-text">
                <span className="gb-req-title">{what}</span>
                <span className="gb-req-sub">
                    {[request.userName || request.userId, to ? t("guildbank.requests.to", { name: to }) : "", formatDateTime(request.createdAt)].filter(Boolean).join(" · ")}
                </span>
                {request.purpose && <span className="gb-req-sub">{t("guildbank.requests.purpose", { purpose: request.purpose })}</span>}
                {!request.linked && (
                    <span className="gb-req-link">
                        <NotLinkedBadge noRaider={!request.userId} />
                        {canWrite && (
                            <Button size="sm" variant="ghost" icon={<LinkIcon />} onClick={() => onLink(request)} aria-label={`${t("guildbank.link.button")}: ${what}`}>
                                {t("guildbank.link.button")}
                            </Button>
                        )}
                    </span>
                )}
            </div>
            {request.linked && canWrite && (
                <IconButton icon={<LinkIcon />} size="sm" tip={t("guildbank.link.relink")} tipSub={t("guildbank.link.relinkTip", { name: to })}
                    aria-label={`${t("guildbank.link.relink")}: ${what}`} onClick={() => onLink(request)} />
            )}
            <Badge
                tone={confirmed ? "accent" : "mid"}
                tip={confirmed && request.handledByName ? t("guildbank.requests.confirmedBy", { name: request.handledByName }) : undefined}
            >
                {t(confirmed ? "guildbank.requests.confirmed" : "guildbank.requests.open")}
            </Badge>
        </li>
    );
}

export default function RequestsDialog({ bankKey, canWrite = false, onClose }: { bankKey: string; canWrite?: boolean; onClose: () => void }) {
    const t = useT();
    const toast = useToast();
    const list = useApi(() => getGuildBankRequests(bankKey), [bankKey]);
    const [linking, setLinking] = useState<GuildBankRequest | null>(null);
    const [busy, setBusy] = useState(false);
    const requests = list.data?.requests || [];
    const unlinked = requests.filter((r) => !r.linked).length;

    const link = async (request: GuildBankRequest, choice: GuildBankCharacterChoice) => {
        setBusy(true);
        try {
            const r = await linkGuildBankRequest(bankKey, request.id, { userId: choice.userId, characterKey: choice.characterKey });
            list.setData((d) => (d ? { requests: d.requests.map((x) => (x.id === r.request.id ? r.request : x)) } : d));
            toast(t("guildbank.link.done", { name: recipientName(choice), raider: choice.userName }), "ok");
            setLinking(null);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={REQUESTS_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.tabsDialog.kicker")}
            title={linking ? t("guildbank.link.title") : t("guildbank.requests.title")}
            width={600}
            footer={linking
                ? <Button variant="ghost" onClick={() => setLinking(null)}>{t("guildbank.waitlist.back")}</Button>
                : <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            {linking ? (
                <CharacterPicker
                    bankKey={bankKey}
                    initialQuery={linking.characterName || linking.userName}
                    busy={busy}
                    onPick={(choice) => { void link(linking, choice); }}
                    intro={<LinkIntro what={t("guildbank.requests.amountItem", { amount: linking.amount, item: linking.item })} current={recipientName(linking)} />}
                />
            ) : (
                <>
                    <p className="gb-hint">{t("guildbank.requests.hint")}</p>
                    {unlinked > 0 && <div className="flash flash-warn">{t("guildbank.requests.unlinked", { count: unlinked })}</div>}
                    {list.error && !list.data && <div className="empty">{list.error.message}</div>}
                    {!list.data && !list.error && <div className="empty">{t("guildbank.requests.loading")}</div>}
                    {list.data && !requests.length && <div className="empty">{t("guildbank.requests.empty")}</div>}
                    {requests.length > 0 && (
                        <ul className="gb-reqs" aria-label={t("guildbank.requests.title")}>
                            {requests.map((r) => <RequestRow key={r.id} request={r} canWrite={canWrite} onLink={setLinking} />)}
                        </ul>
                    )}
                </>
            )}
        </Modal>
    );
}
