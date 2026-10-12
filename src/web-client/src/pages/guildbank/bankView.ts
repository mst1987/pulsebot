// The pure rules of the guild bank page (#632): which items a tab shows, how
// they are grouped and sorted, the tone of "Verfügbar" and the bank-tab line
// under an item's name. The numbers themselves (reserved, available, group)
// come from the server (src/services/guildbank/stockView.js).
import type { GuildBankHandedOut, GuildBankItem, GuildBankStatus, GuildBankTab, GuildBankWaitingEntry } from "../../api";
import { locale, t } from "../../i18n";
import { formatWith, isoDay } from "../../lib/format";

/**
 * The page's tabs, in the order of the design: what raiders see first; "wait"
 * is the waiting list (#775) and "out" what was handed out — no item status.
 */
export type PageTab = GuildBankStatus | "wait" | "out";
export const BANK_TABS: PageTab[] = ["give", "wait", "out", "show", "hide", "new"];

/** The item status whose items a tab lists ("wait" and "out" filter by the offered ones). */
export function itemTabOf(tab: PageTab): GuildBankStatus {
    return tab === "wait" || tab === "out" ? "give" : tab;
}

/** A stored tab id that is none of the page's tabs falls back to the first. */
export function isPageTab(value: string): value is PageTab {
    return (BANK_TABS as string[]).includes(value);
}

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

/** "Tab 2: Edelsteine" (several: joined), or "Nicht in der Bank" for an item that left or was added by hand. */
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

/** An item id or a Wowhead link (item=123): the server reads it as it is, no name search needed. */
export function isDirectItemInput(text: string): boolean {
    const v = text.trim();
    return /^\d{1,12}$/.test(v) || (/wowhead\.com|^item=/i.test(v) && /item[=/]\d+/i.test(v));
}

/** The WoW icon of the "Warteliste" dialogs (#775). */
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

/** The entries the filter line lets through: the item's category and a search in the item's or the waiting player's name. */
export function filterWaitlist(
    entries: GuildBankWaitingEntry[],
    items: Map<number, GuildBankItem>,
    filter: { category: string; search: string },
): GuildBankWaitingEntry[] {
    const needle = filter.search.trim().toLocaleLowerCase(locale());
    return entries.filter((e) => {
        const item = items.get(e.itemId);
        if (filter.category && (!item || groupName(item) !== filter.category)) return false;
        if (!needle) return true;
        return [e.item, waitingName(e), e.characterName].some((s) => (s || "").toLocaleLowerCase(locale()).includes(needle));
    });
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

/** Who receives it in game: "Name-Realm" (the realm without spaces), the name alone without a realm, "" without a name. */
export function recipientName(entry: { characterName: string; realm: string }): string {
    if (!entry.characterName) return "";
    return entry.realm ? `${entry.characterName}-${entry.realm.replace(/\s+/g, "")}` : entry.characterName;
}

/** The handed-out requests the filter line lets through: the item's category and a search in the item, the character or the raider. */
export function filterHandedOut(
    list: GuildBankHandedOut[],
    items: Map<number, GuildBankItem>,
    filter: { category: string; search: string },
): GuildBankHandedOut[] {
    const needle = filter.search.trim().toLocaleLowerCase(locale());
    return list.filter((r) => {
        const item = items.get(r.itemId);
        if (filter.category && (!item || groupName(item) !== filter.category)) return false;
        if (!needle) return true;
        return [r.item, r.characterName, r.userName].some((s) => (s || "").toLocaleLowerCase(locale()).includes(needle));
    });
}

export type HandedOutDay = { day: string; at: number; requests: GuildBankHandedOut[] };

/** The handed-out requests per day (the guild's time zone), newest first (or oldest first), each day's in the same order. */
export function groupHandedOutByDay(list: GuildBankHandedOut[], { newestFirst = true }: { newestFirst?: boolean } = {}): HandedOutDay[] {
    const sorted = [...list].sort((a, b) => (newestFirst ? b.handedOutAt - a.handedOutAt : a.handedOutAt - b.handedOutAt));
    const days: HandedOutDay[] = [];
    for (const r of sorted) {
        const day = isoDay(r.handedOutAt);
        const last = days[days.length - 1];
        if (last && last.day === day) last.requests.push(r);
        else days.push({ day, at: r.handedOutAt, requests: [r] });
    }
    return days;
}

/** "Heute", "Gestern" or the weekday with its date, for a day group's head. */
export function dayLabel(at: number, now: number = Date.now()): string {
    const day = isoDay(at);
    if (day === isoDay(now)) return t("guildbank.handedOut.today");
    if (day === isoDay(now - 24 * 60 * 60 * 1000)) return t("guildbank.handedOut.yesterday");
    return formatWith(at, { weekday: "long", day: "numeric", month: "long" });
}

/** A whole number from 0 as typed, else null. */
export function wholeNumber(text: string): number | null {
    const v = text.trim();
    return /^\d{1,7}$/.test(v) ? Number(v) : null;
}

/**
 * What "ins Profil übernehmen" did (#809), as a sentence for the toast: added,
 * the class is unknown (the orga adds it in the profile by hand), no profile,
 * or the server's own reason; "" when it was not asked for.
 */
export function profileNote(profile: string, raider: string): string {
    if (!profile) return "";
    if (profile === "added") return t("guildbank.link.profileAdded", { raider });
    if (profile === "noClass") return t("guildbank.link.profileNoClass", { raider });
    if (profile === "noProfile") return t("guildbank.link.profileMissing", { raider });
    return t("guildbank.link.profileError", { reason: profile });
}
