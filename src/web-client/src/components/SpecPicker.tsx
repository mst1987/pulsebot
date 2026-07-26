import { useEffect, useMemo, useRef, useState } from "react";
import type { Emoji } from "../api";
import { parseWantedBlock, insertSpecLine, removeSpecLine, type SpecCatalogEntry } from "../lib/recruitmentSpecs";

// Ported from renderAdmin.js's specPickerScript()/specPicker(). Unlike the SSR
// version (which re-parses the textarea's raw DOM value), this re-derives the
// pills from the controlled `value` prop on every render — no debounce needed,
// parseWantedBlock is cheap and the body is never more than a few KB.
function findGuildEmoji(icon: string, emojis: Emoji[]): Emoji | null {
    const key = (icon || "").toLowerCase();
    const exact = emojis.find((e) => (e.name || "").toLowerCase() === key);
    if (exact) return exact;
    const prefix = emojis.find((e) => {
        const n = (e.name || "").toLowerCase();
        return n.length > 3 && key.length > 3 && (n.startsWith(key) || key.startsWith(n));
    });
    return prefix || null;
}

// Prefer the real Discord server emoji (what actually ends up in the message);
// fall back to the generic WoW spec icon only when the guild has none uploaded.
function specIconUrl(spec: SpecCatalogEntry, emojis: Emoji[]): string {
    const emoji = findGuildEmoji(spec.icon, emojis);
    if (emoji?.url) return emoji.url;
    return `https://wow.zamimg.com/images/wow/icons/large/${spec.icon.toLowerCase()}.jpg`;
}

export default function SpecPicker({ value, onChange, specCatalog, emojis }: {
    value: string;
    onChange: (next: string) => void;
    specCatalog: SpecCatalogEntry[];
    emojis: Emoji[];
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const parsed = useMemo(() => parseWantedBlock(value, specCatalog), [value, specCatalog]);
    const available = useMemo(() => {
        const selected = new Set(parsed.entries.filter((e) => e.spec).map((e) => e.spec!.key));
        return specCatalog.filter((s) => !selected.has(s.key));
    }, [parsed, specCatalog]);
    const filtered = available.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, [open]);

    const addSpec = (spec: SpecCatalogEntry) => {
        const emoji = findGuildEmoji(spec.icon, emojis);
        onChange(insertSpecLine(value, spec, emoji?.code || "", specCatalog));
        setOpen(false);
    };

    return (
        <div className="spec-picker" ref={rootRef}>
            <div className="spec-pills">
                {parsed.entries.length === 0 && <span className="hint">Noch nichts ausgewählt — mit „+ Klasse/Spec hinzufügen&quot; unten.</span>}
                {parsed.entries.map((entry) => (
                    <span key={entry.index} className={`spec-pill${entry.spec ? "" : " spec-pill-custom"}`}>
                        {entry.spec ? <img src={specIconUrl(entry.spec, emojis)} alt="" /> : <span className="spec-pill-q">?</span>}
                        <span>{entry.spec ? entry.spec.name : entry.label}</span>
                        <button type="button" className="spec-pill-x" aria-label="Entfernen" onClick={() => onChange(removeSpecLine(value, entry.index))}>
                            &times;
                        </button>
                    </span>
                ))}
            </div>
            <div className="spec-add">
                <button type="button" className="btn btn-ghost btn-sm spec-add-trigger" onClick={() => { setOpen((o) => !o); setSearch(""); }}>
                    + Klasse/Spec hinzufügen
                </button>
                <div className={`spec-add-panel${open ? " open" : ""}`}>
                    <input
                        ref={searchRef} className="spec-add-search" placeholder="Suchen …"
                        value={search} onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="spec-add-list">
                        {filtered.length
                            ? filtered.map((s) => (
                                <button type="button" key={s.key} className="spec-option" onClick={() => addSpec(s)}>
                                    <img src={specIconUrl(s, emojis)} alt="" />
                                    <span>{s.name}</span>
                                </button>
                            ))
                            : <div className="spec-empty">Keine Treffer.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
