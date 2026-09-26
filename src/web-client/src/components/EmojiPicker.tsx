import { useEffect, useRef, useState, type RefObject } from "react";
import type { Emoji } from "../api";
import { Button } from "./ui/Button";
import { useDismiss } from "../hooks/useDismiss";

// Ported from renderAdmin.js's EMOJI_PICKER_SCRIPT/emojiPicker(), adapted for a
// controlled textarea: insertion reads the cursor position from the DOM ref
// (React doesn't track it), splices the code into the string, then restores
// the cursor after the re-render.
export default function EmojiPicker({ emojis, textareaRef, value, onChange }: {
    emojis: Emoji[];
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    value: string;
    onChange: (next: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) searchRef.current?.focus();
    }, [open]);
    useDismiss(rootRef, open, () => setOpen(false), { event: "click", escape: false });

    if (!emojis.length) return null;

    const filtered = emojis.filter((e) => !search || (e.name || "").toLowerCase().includes(search.toLowerCase()));

    const pick = (code: string) => {
        const el = textareaRef.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? start;
        onChange(value.slice(0, start) + code + value.slice(end));
        const cursor = start + code.length;
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(cursor, cursor);
        });
        setOpen(false);
    };

    return (
        <div className="emoji-picker" ref={rootRef}>
            <Button
                variant="ghost" size="sm" icon="inv_misc_head_murloc_01" className="emoji-trigger"
                aria-expanded={open}
                data-tip="Server-Emoji einfügen" data-tip-sub="Fügt den Code <:name:id> an der Cursor-Position ein."
                onClick={() => { setOpen((o) => !o); setSearch(""); }}
            >
                Server-Emoji
            </Button>
            <div className={`emoji-panel${open ? " open" : ""}`}>
                <input
                    ref={searchRef} className="emoji-search" placeholder="Emoji suchen …"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                />
                <div className="emoji-grid">
                    {filtered.length
                        ? filtered.map((e) => (
                            <button key={e.id} type="button" className="emoji-item" data-tip={`:${e.name}:`} aria-label={`:${e.name}:`} onClick={() => pick(e.code)}>
                                <img src={e.url} alt={`:${e.name}:`} loading="lazy" />
                            </button>
                        ))
                        : <div className="emoji-empty">Keine Treffer.</div>}
                </div>
            </div>
        </div>
    );
}
