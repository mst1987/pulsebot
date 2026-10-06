// "Bank-Tabs": hide or show a whole tab of the guild bank (one switch per tab).
// What lies only in a hidden tab shows up nowhere — an officers' tab or a
// storage tab does not have to be sorted item by item. A switch saves at once.
import type { GuildBankItem, GuildBankTab } from "../../api";
import { Button, Modal, Switch } from "../../components/ui";
import { RowsIcon } from "../../components/icons";
import { tParts, useT } from "../../i18n";
import { itemsInTab } from "./bankView";

export default function BankTabsDialog({ tabs, items, canWrite, busyIndex, onClose, onToggle }: {
    tabs: GuildBankTab[];
    items: GuildBankItem[];
    canWrite: boolean;
    /** The tab a change is being saved for. */
    busyIndex: number;
    onClose: () => void;
    onToggle: (tab: GuildBankTab, hidden: boolean) => void;
}) {
    const t = useT();
    return (
        <Modal
            open
            onClose={onClose}
            icon={<RowsIcon />}
            tone="bank"
            kicker={t("guildbank.tabsDialog.kicker")}
            title={t("guildbank.page.bankTabs")}
            width={520}
            footer={<Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>}
        >
            <p className="gb-hint">{t("guildbank.tabsDialog.hint")}</p>
            <div className="gb-tablist">
                {tabs.map((tab) => (
                    <div className="gb-tabrow" key={tab.index}>
                        <Switch
                            checked={!tab.hidden}
                            disabled={!canWrite || busyIndex === tab.index}
                            onChange={(visible) => onToggle(tab, !visible)}
                            label={tab.name ? t("guildbank.list.tab", { index: tab.index, name: tab.name }) : t("guildbank.list.tabNoName", { index: tab.index })}
                        />
                        <span className="gb-tabmeta">
                            {tab.inScan ? tParts("guildbank.tabsDialog.items", { count: itemsInTab(items, tab.index) }) : t("guildbank.tabsDialog.gone")}
                        </span>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
