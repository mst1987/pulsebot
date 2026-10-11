// The pure rules of the guild bank page (#632): which items a tab shows, how
// they are grouped and sorted, the tone of "Verfügbar" and the bank-tab line
// under an item's name. The numbers themselves (reserved, available, group)
// come from the server (src/services/guildbank/stockView.js).
import type { GuildBankItem, GuildBankStatus, GuildBankTab, GuildBankWaitingEntry } from "../../api";
import { locale, t } from "../../i18n";

/** The page's tabs, in the order of the design: what raiders see first. */
export const BANK_TABS: GuildBankStatus[] = ["give", "show", "hide", "new"];

/** The WoW icon of the "Anfragen" button and dialog (#633). */
export const REQUESTS_ICON = "inv_misc_bag_10";

export type BankFilter = { tab: GuildBankStatus; category: string; search: string };

export type ItemGroup = { name: string; items: GuildBankItem[] };

/** The items the page lists at all: an item whose whole stock lies in hidden bank tabs is left out. */
export function listedItems(items: GuildBankItem[]): GuildBankItem[] {
    return items.filter((it) => !it.tabHidden);
}

/** How many listed items each tab holds. */
export function tabCounts(items: GuildBankItem[]): Record<GuildBankStatus, number> {
    const out: Record<GuildBankStatus, number> = { give: 0, show: 0, hide: 0, new: 0 };
    for (const it of listedItems(items)) out[it.status] += 1;
    return out;
}

/** The group name an item is listed under; "Sonstiges" while Wowhead has not named one. */
export function groupName(item: GuildBankItem): string {
    return item.group || t("guildbank.list.other");
}

/** Every group name of the listed items, sorted — the category filter's choices. */
export function groupNames(items: GuildBankItem[]): string[] {
    return sortGroups([...new Set(listedItems(items).map(groupName))]);
}

function sortGroups(names: string[]): string[] {
    const other = t("guildbank.list.other");
    return names.sort((a, b) => (a === other ? 1 : 0) - (b === other ? 1 : 0) || a.localeCompare(b, locale()));
}

/** An item's name, or "Gegenstand 12345" until Wowhead answered. */
export function itemName(item: GuildBankItem): string {
    return item.name || t("guildbank.list.itemFallback", { id: item.itemId });
}

/** The items of one tab, filtered by category and search, grouped and sorted by name. */
export function groupItems(items: GuildBankItem[], filter: BankFilter): ItemGroup[] {
    const needle = filter.search.trim().toLocaleLowerCase(locale());
    const byGroup = new Map<string, GuildBankItem[]>();
    for (const it of listedItems(items)) {
        if (it.status !== filter.tab) continue;
        const group = groupName(it);
        if (filter.category && group !== filter.category) continue;
        if (needle && !itemName(it).toLocaleLowerCase(locale()).includes(needle)) continue;
        byGroup.set(group, [...(byGroup.get(group) || []), it]);
    }
    return sortGroups([...byGroup.keys()]).map((name) => ({
        name,
        items: (byGroup.get(name) || []).sort((a, b) => itemName(a).localeCompare(itemName(b), locale()) || a.itemId - b.itemId),
    }));
}

/** The tone of "Verfügbar": nothing left is bad, a few is mid. */
export function availableTone(available: number): "ok" | "mid" | "bad" {
    if (available <= 0) return "bad";
    return available <= 3 ? "mid" : "ok";
}

/** "Tab 2: Edelsteine" (several: joined), or "Nicht in der Bank" for an item that left or was added by hand (#778). */
export function tabLine(item: GuildBankItem, tabs: GuildBankTab[]): string {
    const names = new Map(tabs.map((tab) => [String(tab.index), tab.name]));
    const parts = Object.keys(item.tabs || {})
        .sort((a, b) => Number(a) - Number(b))
        .map((index) => {
            const name = names.get(index);
            return name ? t("guildbank.list.tab", { index, name }) : t("guildbank.list.tabNoName", { index });
        });
    return parts.length ? parts.join(" · ") : t("guildbank.list.gone");
}

/** How many items lie in a bank tab, hidden or not (the tab dialog's count). */
export function itemsInTab(items: GuildBankItem[], index: number): number {
    return items.filter((it) => Number((it.allTabs || {})[String(index)]) > 0).length;
}

/** An item id or a Wowhead link (item=123): the server reads it as it is, no name search needed (#778). */
export function isDirectItemInput(text: string): boolean {
    const v = text.trim();
    return /^\d{1,12}$/.test(v) || (/wowhead\.com|^item=/i.test(v) && /item[=/]\d+/i.test(v));
}

/** The WoW icon of the "Warteliste" button and dialog (#775). */
export const WAITLIST_ICON = "inv_misc_pocketwatch_01";

/** How many waiting-list entries wait over the listed items (the head's "N warten"). */
export function waitingTotal(items: GuildBankItem[]): number {
    return listedItems(items).reduce((sum, it) => sum + (Number(it.waiting) || 0), 0);
}

export type WaitlistGroup = { itemId: number; item: string; iconUrl: string; entries: GuildBankWaitingEntry[] };

/** The waiting list per item, items by name, each item's entries in their order (place 1 first). */
export function groupWaitlist(entries: GuildBankWaitingEntry[]): WaitlistGroup[] {
    const byItem = new Map<number, WaitlistGroup>();
    for (const e of entries) {
        const group = byItem.get(e.itemId) || { itemId: e.itemId, item: e.item, iconUrl: e.iconUrl, entries: [] };
        group.entries.push(e);
        byItem.set(e.itemId, group);
    }
    return [...byItem.values()]
        .map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => a.position - b.position) }))
        .sort((a, b) => a.item.localeCompare(b.item, locale()) || a.itemId - b.itemId);
}

/** Who waits: the raider's name, else the character imported without a Discord account. */
export function waitingName(entry: GuildBankWaitingEntry): string {
    return entry.userName || entry.characterName || entry.userId;
}

/** The items an orga member may put on the waiting list: offered and not only in hidden tabs, by name. */
export function waitlistItems(items: GuildBankItem[]): GuildBankItem[] {
    return listedItems(items)
        .filter((it) => it.status === "give")
        .sort((a, b) => itemName(a).localeCompare(itemName(b), locale()) || a.itemId - b.itemId);
}

/** A whole number from 0 as typed, else null. */
export function wholeNumber(text: string): number | null {
    const v = text.trim();
    return /^\d{1,7}$/.test(v) ? Number(v) : null;
}
