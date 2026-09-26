import { useEffect, useMemo, useRef, useState } from "react";
import type { Emoji } from "../api";
import {
    parseWantedBlock, insertSpecLine, removeSpecLine, findGuildEmoji, specEmojiUrl, type SpecCatalogEntry,
} from "../lib/recruitmentSpecs";
import { Button } from "./ui/Button";
import WowIcon from "./ui/WowIcon";
import { XIcon } from "./icons";
import { useT } from "../i18n";
import { useDismiss } from "../hooks/useDismiss";

// Ported from renderAdmin.js's specPickerScript()/specPicker(). Unlike the SSR
// version (which re-parses the textarea's raw DOM value), this re-derives the
// pills from the controlled `value` prop on every render — no debounce needed,
// parseWantedBlock is cheap and the body is never more than a few KB.

export function SpecImg({ url }: { url: string }) {
    return url ? <img src={url} alt="" /> : <WowIcon name="inv_misc_questionmark" size={20} />;
}

export default function SpecPicker({ value, onChange, specCatalog, emojis }: {
    value: string;
    onChange: (next: string) => void;
    specCatalog: SpecCatalogEntry[];
    emojis: Emoji[];
}) {
    const t = useT();
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
        if (open) searchRef.current?.focus();
    }, [open]);
    useDismiss(rootRef, open, () => setOpen(false), { event: "click", escape: false });

    const addSpec = (spec: SpecCatalogEntry) => {
        const emoji = findGuildEmoji(spec.icon, emojis);
        onChange(insertSpecLine(value, spec, emoji?.code || "", specCatalog));
        setOpen(false);
    };

    return (
        <div className="spec-picker" ref={rootRef}>
            {parsed.entries.map((entry) => (
                <span key={entry.index} className={`spec-pill${entry.spec ? "" : " spec-pill-custom"}`}>
                    {entry.spec ? <SpecImg url={specEmojiUrl(entry.iconId, entry.spec.icon, emojis)} /> : <span className="spec-pill-q">?</span>}
                    <span>{entry.spec ? entry.spec.name : entry.label}</span>
                    <button
                        type="button" className="spec-pill-x" aria-label={t("signups.specPicker.removeAria", { name: entry.spec ? entry.spec.name : entry.label })}
                        data-tip={t("signups.specPicker.remove")} onClick={() => onChange(removeSpecLine(value, entry.index))}
                    >
                        <XIcon />
                    </button>
                </span>
            ))}
            <div className="spec-add">
                <Button
                    variant="ghost" size="sm" icon="inv_misc_grouplooking" className="spec-add-trigger" aria-expanded={open}
                    onClick={() => { setOpen((o) => !o); setSearch(""); }}
                >
                    {t("signups.specPicker.add")}
                </Button>
                <div className={`spec-add-panel${open ? " open" : ""}`}>
                    <input
                        ref={searchRef} className="spec-add-search" placeholder={t("signups.specPicker.search")}
                        value={search} onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="spec-add-list">
                        {filtered.length
                            ? filtered.map((s) => (
                                <button type="button" key={s.key} className="spec-option" onClick={() => addSpec(s)}>
                                    <SpecImg url={specEmojiUrl("", s.icon, emojis)} />
                                    <span>{s.name}</span>
                                </button>
                            ))
                            : <div className="spec-empty">{t("signups.specPicker.noHits")}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
