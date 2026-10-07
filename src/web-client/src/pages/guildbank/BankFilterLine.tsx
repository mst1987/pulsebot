// The filter line under the tabs, like the Loot-Council's: the category as a
// button with a small box, the search, and the formula behind "Verfügbar".
// With several banks on the server (TBC and Forever) a select picks one.
import { useRef, useState } from "react";
import type { GuildBankSummary } from "../../api";
import { SearchBox } from "../../components/loot/LootFilters";
import { ChevronDownIcon, FunnelIcon } from "../../components/icons";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";

export default function BankFilterLine({ categories, category, onCategory, search, onSearch, banks, bankKey, onBank }: {
    categories: string[];
    category: string;
    onCategory: (category: string) => void;
    search: string;
    onSearch: (search: string) => void;
    banks: GuildBankSummary[];
    bankKey: string;
    onBank: (key: string) => void;
}) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, open, () => setOpen(false));

    return (
        <div className="lc-filterline">
            {banks.length > 1 && (
                <select className="gb-banksel" aria-label={t("guildbank.page.pickBank")} value={bankKey} onChange={(e) => onBank(e.target.value)}>
                    {banks.map((b) => <option key={b.key} value={b.key}>{`${b.versionShort} · ${b.guild} · ${b.realm}`}</option>)}
                </select>
            )}
            <div className="lc-fpop" ref={ref}>
                <button
                    type="button"
                    className={`lc-selbtn${category ? " on" : ""}`}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen((v) => !v)}
                >
                    <FunnelIcon />
                    <span>{t("guildbank.filter.category", { name: category || t("guildbank.filter.allCategories") })}</span>
                    <ChevronDownIcon />
                </button>
                {open && (
                    <div className="lc-fpopmenu" role="dialog" aria-label={t("guildbank.filter.categoryLabel")}>
                        <div className="lc-field lc-field-wide">
                            <label className="kicker" htmlFor="gb-f-category">{t("guildbank.filter.categoryLabel")}</label>
                            <select
                                id="gb-f-category"
                                className="lc-sel"
                                value={category}
                                onChange={(e) => { onCategory(e.target.value); setOpen(false); }}
                            >
                                <option value="">{t("guildbank.filter.allCategories")}</option>
                                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                )}
            </div>
            <SearchBox id="gb-search" value={search} onChange={onSearch} placeholder={t("guildbank.filter.search")} />
            <span className="gb-formula">{t("guildbank.filter.formula")}</span>
        </div>
    );
}
