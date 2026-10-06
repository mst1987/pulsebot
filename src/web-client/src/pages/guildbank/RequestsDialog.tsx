// "Anfragen" (#633): the bank's requests from the stock that still wait — open
// ones for the orga (confirmed or declined in Discord, in the guild bank's orga
// channel) and confirmed ones waiting for the hand-out in game. Read-only: the
// decisions stay on the Discord card, where the raider gets the DM.
import { getGuildBankRequests, type GuildBankRequest } from "../../api";
import { Badge, Button, Modal, WowIcon } from "../../components/ui";
import { ItemIcon } from "../../components/loot/LootBadges";
import { useApi } from "../../hooks/useApi";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../i18n";
import { REQUESTS_ICON } from "./bankView";

function recipient(r: GuildBankRequest): string {
    if (!r.characterName) return "";
    return r.realm ? `${r.characterName}-${r.realm.replace(/\s+/g, "")}` : r.characterName;
}

function RequestRow({ request }: { request: GuildBankRequest }) {
    const t = useT();
    const to = recipient(request);
    const confirmed = request.status === "confirmed";
    return (
        <li className="gb-req">
            <ItemIcon url={request.iconUrl} />
            <div className="gb-req-text">
                <span className="gb-req-title">{t("guildbank.requests.amountItem", { amount: request.amount, item: request.item })}</span>
                <span className="gb-req-sub">
                    {[request.userName || request.userId, to ? t("guildbank.requests.to", { name: to }) : "", formatDateTime(request.createdAt)].filter(Boolean).join(" · ")}
                </span>
                {request.purpose && <span className="gb-req-sub">{t("guildbank.requests.purpose", { purpose: request.purpose })}</span>}
            </div>
            <Badge
                tone={confirmed ? "accent" : "mid"}
                tip={confirmed && request.handledByName ? t("guildbank.requests.confirmedBy", { name: request.handledByName }) : undefined}
            >
                {t(confirmed ? "guildbank.requests.confirmed" : "guildbank.requests.open")}
            </Badge>
        </li>
    );
}

export default function RequestsDialog({ bankKey, onClose }: { bankKey: string; onClose: () => void }) {
    const t = useT();
    const list = useApi(() => getGuildBankRequests(bankKey), [bankKey]);
    const requests = list.data?.requests || [];
    return (
        <Modal
            open
            onClose={onClose}
            icon={<WowIcon name={REQUESTS_ICON} size={22} />}
            tone="bank"
            kicker={t("guildbank.tabsDialog.kicker")}
            title={t("guildbank.requests.title")}
            width={560}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <p className="gb-hint">{t("guildbank.requests.hint")}</p>
            {list.error && !list.data && <div className="empty">{list.error.message}</div>}
            {!list.data && !list.error && <div className="empty">{t("guildbank.requests.loading")}</div>}
            {list.data && !requests.length && <div className="empty">{t("guildbank.requests.empty")}</div>}
            {requests.length > 0 && (
                <ul className="gb-reqs" aria-label={t("guildbank.requests.title")}>
                    {requests.map((r) => <RequestRow key={r.id} request={r} />)}
                </ul>
            )}
        </Modal>
    );
}
