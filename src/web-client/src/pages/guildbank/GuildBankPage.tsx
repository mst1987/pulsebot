// "Gildenbank" (#632): the stock the addon scanned and what the orga decided
// per item — design "Webseite: Gildenbank" (Canvas of epic #635).
//
//   Ausgebbar     raiders may request it (Discord form, #633)
//   Nur Bestand   visible, not requestable
//   Ausgeblendet  shows up nowhere
//   Neu           came with the last scan, still to be sorted
//
// The bank shown is the active server's: the one of the topbar's content
// version, else the first; with several a select in the filter line picks
// one. "Verfügbar" is Bestand - Vorgemerkt - Reserve, computed by the server
// (services/guildbank/stockView.js) — the request form uses the same number.
// Reading takes "raids", every change "raids" write.
import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
    canAccess, getGuildBank, setGuildBankItem, setGuildBankTabHidden,
    type ApiError, type GuildBankItem, type GuildBankItemPatch, type GuildBankPageData, type GuildBankStatus, type GuildBankTab,
} from "../../api";
import type { ShellContext } from "../../components/Shell";
import { Badge, Button, PageHead, RaidLoader, WowIcon, buttonClass } from "../../components/ui";
import { RowsIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { usePersistedState } from "../../lib/persistedState";
import { formatDateTime, formatMoney } from "../../lib/format";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { tParts, useT } from "../../i18n";
import { BANK_TABS, groupItems, groupNames, tabCounts } from "./bankView";
import BankFilterLine from "./BankFilterLine";
import BankList from "./BankList";
import ItemSettingsDialog from "./ItemSettingsDialog";
import BankTabsDialog from "./BankTabsDialog";
import "../../styles/loot-council.css";
import "../../styles/historie-loot.css";
import "../../styles/guildbank.css";

const BANK_ICON = "achievement_guildperk_mobilebanking";

/** No bank on this server yet: what brings one in, and where it is assigned. */
function EmptyBank({ canSettings }: { canSettings: boolean }) {
    const t = useT();
    return (
        <>
            <PageHead icon={BANK_ICON} tone="bank" title={t("guildbank.title")} />
            <div className="gb-empty empty">
                <WowIcon name={BANK_ICON} size={48} />
                <h2>{t("guildbank.empty.title")}</h2>
                <p>{t("guildbank.empty.text")}</p>
                <p>{t("guildbank.empty.assign")}</p>
                {canSettings && (
                    <Link className={buttonClass("ghost")} to="/settings?section=verbindungen">{t("guildbank.empty.toSettings")}</Link>
                )}
            </div>
        </>
    );
}

export default function GuildBankPage() {
    const t = useT();
    const toast = useToast();
    const { user } = useOutletContext<ShellContext>();
    const canWrite = canAccess(user, "raids", "write");
    const { version } = useContentVersion();
    // A bank picked by hand counts while the content version stays the same;
    // switching the version follows the version again.
    const [picked, setPicked] = useState({ key: "", version });
    const key = picked.version === version ? picked.key : "";
    const page = useApi<GuildBankPageData>(() => getGuildBank({ key, version }), [key, version]);
    const [tab, setTab] = usePersistedState<GuildBankStatus>("guildbank-tab", "give");
    const [category, setCategory] = useState("");
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<GuildBankItem | null>(null);
    const [bankTabsOpen, setBankTabsOpen] = useState(false);
    const [busyItem, setBusyItem] = useState(0);
    const [busyTab, setBusyTab] = useState(0);

    const bank = page.data?.bank || null;
    const items = useMemo(() => bank?.items || [], [bank]);
    const categories = useMemo(() => groupNames(items), [items]);
    // a category the list no longer has (its last item was re-sorted) filters nothing
    const activeCategory = categories.includes(category) ? category : "";
    const groups = useMemo(() => groupItems(items, { tab, category: activeCategory, search }), [items, tab, activeCategory, search]);
    useEffect(() => { refreshWowheadLinks(); }, [groups]);

    if (page.error && !page.data) return <div className="empty">{page.error.message}</div>;
    if (!page.data) return <RaidLoader text={t("guildbank.page.loading")} />;
    if (!bank) return <EmptyBank canSettings={canAccess(user, "settings")} />;

    const counts = tabCounts(items);
    const hiddenTabs = bank.tabs.filter((x) => x.hidden).length;

    const replaceItem = (item: GuildBankItem) => page.setData((d) => (d && d.bank
        ? { ...d, bank: { ...d.bank, items: d.bank.items.map((it) => (it.itemId === item.itemId ? item : it)) } }
        : d));

    const saveItem = async (item: GuildBankItem, patch: GuildBankItemPatch): Promise<boolean> => {
        setBusyItem(item.itemId);
        try {
            const r = await setGuildBankItem(bank.key, item.itemId, patch);
            replaceItem(r.item);
            return true;
        } catch (err) {
            toast((err as ApiError).message, "err");
            return false;
        } finally {
            setBusyItem(0);
        }
    };

    const toggleTab = async (bankTab: GuildBankTab, hidden: boolean) => {
        setBusyTab(bankTab.index);
        try {
            await setGuildBankTabHidden(bank.key, bankTab.index, hidden);
            // the counts of every item in that tab change: read the bank again
            await page.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusyTab(0);
        }
    };

    const kicker = bank.scannedBy
        ? t("guildbank.page.kicker", { version: bank.versionShort, realm: bank.realm, date: formatDateTime(bank.scannedAt), name: bank.scannedBy })
        : t("guildbank.page.kickerNoScanner", { version: bank.versionShort, realm: bank.realm, date: formatDateTime(bank.scannedAt) });

    return (
        <>
            <PageHead
                icon={BANK_ICON}
                tone="bank"
                kicker={kicker}
                title={t("guildbank.title")}
                meta={(
                    <>
                        <Badge tip={t("guildbank.page.goldTip")} tipSub={t("guildbank.page.goldTipSub")}>{formatMoney(bank.money)}</Badge>
                        <Badge tip={hiddenTabs ? t("guildbank.page.tabsHidden", { count: hiddenTabs }) : undefined}>
                            {tParts("guildbank.page.tabsCount", { count: bank.tabs.length })}
                        </Badge>
                        {bank.reservedRequests > 0 && (
                            <Badge tone="mid" tip={t("guildbank.page.reservedTip")}>{tParts("guildbank.page.reserved", { count: bank.reservedRequests })}</Badge>
                        )}
                    </>
                )}
                action={<Button variant="ghost" icon={<RowsIcon />} onClick={() => setBankTabsOpen(true)}>{t("guildbank.page.bankTabs")}</Button>}
            />

            <div className="tabs gb-tabs" role="tablist">
                {BANK_TABS.map((id) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        className={`tab-btn${tab === id ? " active" : ""}`}
                        onClick={() => setTab(id)}
                    >
                        {t(`guildbank.tabs.${id}`)}{" "}
                        <span className={`tab-count${id === "new" && counts.new > 0 ? " gb-hot" : ""}`}>{counts[id]}</span>
                    </button>
                ))}
            </div>

            <BankFilterLine
                categories={categories}
                category={activeCategory}
                onCategory={setCategory}
                search={search}
                onSearch={setSearch}
                banks={page.data.banks}
                bankKey={bank.key}
                onBank={(k) => setPicked({ key: k, version })}
            />

            {tab === "new" && counts.new > 0 && <div className="flash gb-notice">{t("guildbank.newNotice")}</div>}

            <BankList
                groups={groups}
                tabs={bank.tabs}
                wowheadPath={bank.wowheadPath}
                canWrite={canWrite}
                busyId={busyItem}
                onStatus={(item, status) => { void saveItem(item, { status }); }}
                onSettings={setEditing}
            />

            {editing && (
                <ItemSettingsDialog
                    item={editing}
                    saving={busyItem === editing.itemId}
                    onClose={() => setEditing(null)}
                    onSave={async (patch) => { if (await saveItem(editing, patch)) setEditing(null); }}
                />
            )}
            {bankTabsOpen && (
                <BankTabsDialog
                    tabs={bank.tabs}
                    items={items}
                    canWrite={canWrite}
                    busyIndex={busyTab}
                    onClose={() => setBankTabsOpen(false)}
                    onToggle={(bankTab, hidden) => { void toggleTab(bankTab, hidden); }}
                />
            )}
        </>
    );
}
