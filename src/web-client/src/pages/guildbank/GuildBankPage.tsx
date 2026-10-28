// "Gildenbank" (#632): the stock the addon scanned and what the orga decided
// per item — design "Webseite: Gildenbank" (Canvas of epic #635).
//
//   Ausgebbar     raiders may request it (Discord form, #633)
//   Warteliste    who waits for an offered item, in order (#775)
//   Anfragen      open and set-aside requests with their recipient (RequestsTab.tsx)
//   Ausgegeben    what went to whom once it was ticked off (HandedOutTab.tsx)
//   Nur Bestand   visible, not requestable
//   Ausgeblendet  shows up nowhere
//   Neu           came with the last scan, still to be sorted
//
// The bank shown is the active server's of the topbar's content version — never
// one of another version (#741; none = the empty page names the versions that
// have one); with several of the version a select in the filter line picks
// one. "Verfügbar" is Bestand - Vorgemerkt - Reserve, computed by the server
// (services/guildbank/stockView.js) — the request form uses the same number.
// Reading takes "raids", every change "raids" write. Every offered item has a
// waiting list (#775): the head counts who waits, each row says how many, the
// "Warteliste" tab keeps them (WaitlistTab.tsx), next to "Ausgebbar". A
// request is only confirmed with a linked character (the addon mails to it):
// the waiting list and "Anfragen" mark the others "nicht verknüpft" and link
// them (CharacterPicker.tsx).
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
    addGuildBankItem, canAccess, getGuildBank, getGuildBankRequests, setGuildBankItem, setGuildBankTabHidden,
    type ApiError, type GuildBankItem, type GuildBankItemPatch, type GuildBankPageData, type GuildBankTab,
} from "../../api";
import type { ShellContext } from "../../components/shell/Shell";
import AllSettingsLink from "../../components/settings/AllSettingsLink";
import { Badge, Button, PageHead, RaidLoader, WowIcon, buttonClass } from "../../components/ui";
import { PlusIcon, RowsIcon, SheetIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useApi } from "../../hooks/useApi";
import { useContentVersion } from "../../hooks/useContentVersion";
import { usePersistedState } from "../../lib/ui/persistedState";
import { formatDateTime, formatMoney } from "../../lib/format";
import { refreshWowheadLinks } from "../../lib/wow/wowheadTooltips";
import { tParts, useT } from "../../i18n";
import { BANK_TABS, isPageTab, itemName, itemTabOf, groupItems, groupNames, reservedByItem, tabCounts, waitingTotal, type PageTab } from "./bankView";
import HandedOutTab from "./HandedOutTab";
import AddItemDialog from "./AddItemDialog";
import BankFilterLine from "./BankFilterLine";
import BankList from "./BankList";
import ItemSettingsDialog from "./ItemSettingsDialog";
import BankTabsDialog from "./BankTabsDialog";
import RequestsTab from "./RequestsTab";
import WaitlistAddDialog from "./WaitlistAddDialog";
import WaitlistImportDialog from "./WaitlistImportDialog";
import WaitlistTab from "./WaitlistTab";
import "../../styles/loot-council.css";
import "../../styles/history-loot.css";
import "../../styles/guildbank.css";

const BANK_ICON = "guildbank";

/**
 * No bank of this version on this server yet (#741: never another version's):
 * what brings one in, where it is assigned — and which other versions have
 * one (`others`, switched in the top bar).
 */
function EmptyBank({ canSettings, version, others }: { canSettings: boolean; version: string; others: string[] }) {
    const t = useT();
    return (
        <>
            <PageHead icon={BANK_ICON} tone="bank" title={t("guildbank.title")} />
            <div className="gb-empty empty">
                <WowIcon name={BANK_ICON} size={48} />
                <h2>{others.length > 0 && version ? t("guildbank.empty.versionTitle", { version }) : t("guildbank.empty.title")}</h2>
                {others.length > 0 && <p>{t("guildbank.empty.otherVersions", { versions: others.join(", ") })}</p>}
                <p>{t("guildbank.empty.text")}</p>
                <p>{t("guildbank.empty.assign")}</p>
                {canSettings && (
                    <AllSettingsLink className={buttonClass("ghost")} section="verbindungen">{t("guildbank.empty.toSettings")}</AllSettingsLink>
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
    const { version, mainVersion, versions } = useContentVersion();
    // A bank picked by hand counts while the content version stays the same;
    // switching the version follows the version again.
    const [picked, setPicked] = useState({ key: "", version });
    const key = picked.version === version ? picked.key : "";
    const page = useApi<GuildBankPageData>(() => getGuildBank({ key, version }), [key, version]);
    const [storedTab, setTab] = usePersistedState<PageTab>("guildbank-tab", "give");
    const tab: PageTab = isPageTab(storedTab) ? storedTab : "give";
    const [category, setCategory] = useState("");
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<GuildBankItem | null>(null);
    const [bankTabsOpen, setBankTabsOpen] = useState(false);
    const [waitAdd, setWaitAdd] = useState(false);
    const [waitImport, setWaitImport] = useState(false);
    const [waitToken, setWaitToken] = useState(0);
    const [addOpen, setAddOpen] = useState(false);
    const [adding, setAdding] = useState(false);
    const [busyItem, setBusyItem] = useState(0);
    const [busyTab, setBusyTab] = useState(0);

    const bank = page.data?.bank || null;
    // The bank's open and set-aside requests, read once: the "Anfragen" tab, its count and the "Vorgemerkt" popover of the item list share them.
    const requests = useApi(() => getGuildBankRequests(bank ? bank.key : ""), [bank ? bank.key : "", waitToken], { enabled: !!bank });
    const reservedBy = useMemo(() => reservedByItem(requests.data?.requests || []), [requests.data]);
    const items = useMemo(() => bank?.items || [], [bank]);
    const categories = useMemo(() => groupNames(items), [items]);
    // a category the list no longer has (its last item was re-sorted) filters nothing
    const activeCategory = categories.includes(category) ? category : "";
    const groups = useMemo(() => groupItems(items, { tab: itemTabOf(tab), category: activeCategory, search }), [items, tab, activeCategory, search]);
    useEffect(() => { refreshWowheadLinks(); }, [groups]);

    if (page.error && !page.data) return <div className="empty">{page.error.message}</div>;
    if (!page.data) return <RaidLoader text={t("guildbank.page.loading")} />;
    if (!bank) {
        const shown = versions.find((v) => v.id === (version || mainVersion));
        return <EmptyBank canSettings={canAccess(user, "settings")} version={shown?.short || ""} others={page.data.otherVersions || []} />;
    }

    const counts = tabCounts(items);
    const hiddenTabs = bank.tabs.filter((x) => x.hidden).length;
    const waiting = waitingTotal(items);
    const tabCount = { ...counts, wait: waiting, req: requests.data ? requests.data.requests.length : 0, out: bank.handedOutRequests || 0 };
    // entries came in by hand or by import: the list and the item numbers are read again
    const waitDone = () => {
        setWaitAdd(false);
        setWaitImport(false);
        setWaitToken((n) => n + 1);
        void page.reload();
    };

    // "Alle im Tab Anfragen" of a Vorgemerkt popover: the tab, filtered by that item
    const showRequestsOf = (item: GuildBankItem) => {
        setTab("req");
        setCategory("");
        setSearch(itemName(item));
    };

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

    // An item by hand: it lands on "Ausgebbar", so the list shows that tab.
    const addItem = async (input: { itemId: number } | { query: string }) => {
        setAdding(true);
        try {
            const r = await addGuildBankItem(bank.key, input);
            setAddOpen(false);
            setTab("give");
            setCategory("");
            setSearch("");
            toast(t(r.created ? "guildbank.add.added" : "guildbank.add.known", { name: itemName(r.item) }), "ok");
            await page.reload();
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setAdding(false);
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
                            <button type="button" className="gb-badge-link" onClick={() => setTab("req")}>
                                <Badge tone="mid" tip={t("guildbank.page.reservedTip")}>{tParts("guildbank.page.reserved", { count: bank.reservedRequests })}</Badge>
                            </button>
                        )}
                        {waiting > 0 && (
                            <button type="button" className="gb-badge-link" onClick={() => setTab("wait")}>
                                <Badge tone="accent" tip={t("guildbank.page.waitingTip")}>{tParts("guildbank.page.waiting", { count: waiting })}</Badge>
                            </button>
                        )}
                    </>
                )}
                action={(
                    <>
                        {canWrite && <Button variant="ghost" icon={<PlusIcon />} onClick={() => setAddOpen(true)}>{t("guildbank.add.button")}</Button>}
                        <Button variant="ghost" icon={<RowsIcon />} onClick={() => setBankTabsOpen(true)}>{t("guildbank.page.bankTabs")}</Button>
                    </>
                )}
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
                        <span className={`tab-count${id === "new" && counts.new > 0 ? " gb-hot" : ""}`}>{tabCount[id]}</span>
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
                searchPlaceholder={tab === "wait" || tab === "req" || tab === "out" ? t("guildbank.filter.searchWait") : undefined}
                showFormula={tab !== "out"}
                actions={tab === "wait" && canWrite ? (
                    <>
                        <Button variant="ghost" icon={<PlusIcon />} onClick={() => setWaitAdd(true)}>{t("guildbank.waitlist.viewAdd")}</Button>
                        <Button variant="ghost" icon={<SheetIcon />} onClick={() => setWaitImport(true)}>{t("guildbank.waitlist.viewImport")}</Button>
                    </>
                ) : undefined}
            />

            {tab === "new" && counts.new > 0 && <div className="flash gb-notice">{t("guildbank.newNotice")}</div>}

            {tab === "wait" ? (
                <WaitlistTab
                    bankKey={bank.key}
                    items={items}
                    canWrite={canWrite}
                    category={activeCategory}
                    search={search}
                    reloadToken={waitToken}
                    onChanged={() => { void page.reload(); }}
                />
            ) : tab === "req" ? (
                <RequestsTab
                    bankKey={bank.key}
                    list={requests}
                    items={items}
                    canWrite={canWrite}
                    category={activeCategory}
                    search={search}
                    onChanged={() => { void page.reload(); }}
                />
            ) : tab === "out" ? (
                <HandedOutTab bankKey={bank.key} items={items} category={activeCategory} search={search} reloadToken={waitToken} />
            ) : (
                <BankList
                    groups={groups}
                    tabs={bank.tabs}
                    wowheadPath={bank.wowheadPath}
                    canWrite={canWrite}
                    busyId={busyItem}
                    reservedBy={reservedBy}
                    onShowRequests={showRequestsOf}
                    onStatus={(item, status) => { void saveItem(item, { status }); }}
                    onSettings={setEditing}
                />
            )}

            {editing && (
                <ItemSettingsDialog
                    item={editing}
                    saving={busyItem === editing.itemId}
                    onClose={() => setEditing(null)}
                    onSave={async (patch) => { if (await saveItem(editing, patch)) setEditing(null); }}
                />
            )}
            {addOpen && (
                <AddItemDialog bankKey={bank.key} saving={adding} onClose={() => setAddOpen(false)} onAdd={(input) => { void addItem(input); }} />
            )}
            {waitAdd && canWrite && <WaitlistAddDialog bankKey={bank.key} items={items} onClose={() => setWaitAdd(false)} onDone={waitDone} />}
            {waitImport && canWrite && <WaitlistImportDialog bankKey={bank.key} onClose={() => setWaitImport(false)} onDone={waitDone} />}
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
