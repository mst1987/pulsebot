// Live Wowhead item search dropdown — same shape as EmojiPicker/SpecPicker
// (debounced fetch, click-outside-to-close, add-to-list-on-pick).
//
// Which endpoint it searches is the caller's business: the softres tab hits the
// raids-area search, the top-item picker in Einstellungen → Loot the settings
// one. Both render an identical list, so the lookup comes in as a prop instead
// of being duplicated per page.
import { useEffect, useRef, useState } from "react";
import type { ItemSearchResult } from "../../api";
import { itemQualityProps } from "../../lib/itemQuality";
import { useT } from "../../i18n";
import { useDismiss } from "../../hooks/useDismiss";

export default function ItemSearchPicker({ search, onPick, placeholder }: {
    search: (q: string) => Promise<{ items: ItemSearchResult[] }>;
    onPick: (item: ItemSearchResult) => void;
    placeholder?: string;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ItemSearchResult[]>([]);
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setResults([]);
            setOpen(false);
            return;
        }
        const handle = setTimeout(() => {
            search(q)
                .then((r) => {
                    setResults(r.items || []);
                    setOpen(true);
                })
                .catch(() => {
                    setResults([]);
                    setOpen(false);
                });
        }, 250);
        return () => clearTimeout(handle);
    }, [query, search]);

    useDismiss(rootRef, open, () => setOpen(false), { event: "click", escape: false });

    const pick = (item: ItemSearchResult) => {
        onPick(item);
        setQuery("");
        setResults([]);
        setOpen(false);
    };

    return (
        <div className="hr-picker" ref={rootRef}>
            <input
                type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder ?? t("raidModals.itemSearch.placeholder")} autoComplete="off"
                onFocus={() => { if (results.length) setOpen(true); }}
            />
            <div className={`hr-panel${open ? " open" : ""}`}>
                {results.map((it) => (
                    <div key={it.id} className="hr-row" onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
                        {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                        <span {...itemQualityProps(it.quality)}>{it.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
