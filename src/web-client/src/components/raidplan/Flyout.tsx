import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { SEARCH_FROM, filterItems, paginate, rangeKeys, sectionsOf, ticked, toggleAllKeys, type FlyItem, type FlySection } from "../../lib/flyout";
import { useT } from "../../i18n";

export type FlyoutOption = FlyItem & { node: ReactNode };

/**
 * The picker of the raid plan (docs/raidplan.md): a panel that opens BESIDE what opened it (right of the card, left when
 * there is no room; a bottom sheet on a phone), so it covers none of the rows one works in. Its entries are compact
 * chips in sections side by side; it never scrolls: when the room ends there is another page, and a search field and
 * tabs by section appear when there are many entries. Several can be ticked (it stays open until "Fertig", a click
 * beside it or Esc), Shift-click ticks a range, "Alle" a whole section. Keys: arrows move in the grid, Space ticks,
 * Esc closes, Tab stays inside.
 */
export default function Flyout({ anchor, title, options, onToggle, onClose, multi = true, top, onText, textPlaceholder }: {
    anchor: HTMLElement | null;
    title: string;
    options: FlyoutOption[];
    onToggle: (key: string) => void;
    onClose: () => void;
    multi?: boolean;
    /** Actions above the grid (e.g. put a slot on the map). */
    top?: ReactNode;
    onText?: (text: string) => void;
    textPlaceholder?: string;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState("");
    const [page, setPage] = useState(0);
    const [cap, setCap] = useState(36);
    const [text, setText] = useState("");
    const panel = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    const last = useRef("");

    const groups = useMemo(() => sectionsOf(options).map((s) => s.title), [options]);
    const visible = useMemo(() => filterItems(options, query, tab) as FlyoutOption[], [options, query, tab]);
    const pages = useMemo(() => paginate(sectionsOf(visible), cap), [visible, cap]);
    const at = Math.min(page, Math.max(0, pages.length - 1));
    const shown = pages[at] ? pages[at].sections : [];
    const nodeOf = useMemo(() => new Map(options.map((o) => [o.key, o.node])), [options]);

    // No scrolling: when the page does not fit its room, fewer chips go on a page.
    useLayoutEffect(() => {
        const el = body.current;
        if (el && el.scrollHeight > el.clientHeight + 1 && cap > 4) setCap((c) => Math.max(4, c - 2));
    }, [cap, at, visible, query, tab, shown.length]);

    useEffect(() => {
        const away = (e: Event) => {
            const el = e.target as Node;
            if (panel.current && !panel.current.contains(el) && !(anchor && anchor.contains(el))) onClose();
        };
        document.addEventListener("pointerdown", away, true);
        const first = body.current ? body.current.querySelector<HTMLElement>(".rp-fchip") : null;
        // after the click that opened it has finished (it would take the focus back to its button otherwise)
        const focusTimer = window.setTimeout(() => (first || panel.current)?.focus(), 0);
        return () => { window.clearTimeout(focusTimer); document.removeEventListener("pointerdown", away, true); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const close = () => { onClose(); if (anchor) anchor.focus(); };

    const click = (item: FlyoutOption, e: MouseEvent) => {
        if (!multi) { onToggle(item.key); onClose(); return; }
        if (e.shiftKey && last.current) {
            const desired = !item.on;
            const keys = rangeKeys(visible.map((v) => v.key), last.current, item.key);
            for (const k of keys) { const v = visible.find((x) => x.key === k); if (v && v.on !== desired) onToggle(k); }
        } else {
            onToggle(item.key);
        }
        last.current = item.key;
    };

    const keys = (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); return; }
        // Enter confirms (a chip or a button does its own thing with it; the search field and the dialog itself end it)
        if (e.key === "Enter" && ((e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLElement).className.indexOf("rp-fly-search") >= 0)) { e.preventDefault(); close(); return; }
        const el = panel.current;
        if (!el) return;
        if (e.key === "Tab") {
            const list = Array.from(el.querySelectorAll<HTMLElement>("button:not(:disabled), input"));
            if (list.length === 0) return;
            const i = list.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
            else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
            return;
        }
        if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(e.key)) return;
        const chips = Array.from(el.querySelectorAll<HTMLElement>(".rp-fchip"));
        const i = chips.indexOf(document.activeElement as HTMLElement);
        if (i < 0) return;
        e.preventDefault();
        if (e.key === "ArrowRight") chips[Math.min(chips.length - 1, i + 1)].focus();
        else if (e.key === "ArrowLeft") chips[Math.max(0, i - 1)].focus();
        else {
            // up / down: the nearest chip of the row above / below
            const r = chips[i].getBoundingClientRect();
            const rows = chips.filter((c) => (e.key === "ArrowDown" ? c.getBoundingClientRect().top > r.bottom - 2 : c.getBoundingClientRect().bottom < r.top + 2));
            if (rows.length === 0) return;
            const edge = e.key === "ArrowDown" ? Math.min(...rows.map((c) => c.getBoundingClientRect().top)) : Math.max(...rows.map((c) => c.getBoundingClientRect().top));
            const row = rows.filter((c) => Math.abs(c.getBoundingClientRect().top - edge) < 4);
            row.sort((a, b) => Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left));
            row[0].focus();
        }
    };

    const sectionKeys = (s: FlySection) => toggleAllKeys({ title: s.title, items: visible.filter((v) => v.group === s.title) });
    const count = ticked(options);
    return createPortal(
        <>
        <div className="rp-fly-back" onClick={close} aria-hidden="true" />
        <div ref={panel} className="rp-fly is-modal" role="dialog" aria-label={title} aria-modal="true" tabIndex={-1} onKeyDown={keys}>
            <header className="rp-fly-head">
                <strong>{title}</strong>
                {count > 0 && <span className="rp-fly-count" aria-label={t("raidBoard.fly.ticked", { count })}>{count}</span>}
                {multi && <button type="button" className="rp-fly-done" onClick={close}>{t("raidBoard.fly.done")}</button>}
            </header>
            {top && <div className="rp-fly-top">{top}</div>}
            {options.length >= SEARCH_FROM && (
                <input className="rp-fly-search" value={query} placeholder={t("raidBoard.fly.search")} aria-label={t("raidBoard.fly.search")} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
            )}
            {groups.length > 2 && options.length > 12 && (
                <div className="rp-fly-tabs" role="tablist">
                    {["", ...groups].map((g) => (
                        <button key={g || "all"} type="button" role="tab" aria-selected={tab === g} className={tab === g ? "is-on" : ""} onClick={() => { setTab(g); setPage(0); }}>{g || t("raidBoard.fly.all")}</button>
                    ))}
                </div>
            )}
            <div className="rp-fly-body" ref={body}>
                {shown.map((s, i) => (
                    <section key={`${s.title}-${i}`} className="rp-fly-sec">
                        <h4>
                            <span>{s.title}</span>
                            {multi && s.items.length > 1 && <button type="button" className="rp-fly-all" aria-label={t("raidBoard.fly.allOf", { what: s.title })} onClick={() => { for (const k of sectionKeys(s)) onToggle(k); }}>{t("raidBoard.fly.all")}</button>}
                        </h4>
                        <div className="rp-fly-chips">
                            {s.items.map((it) => (
                                <button key={it.key} type="button" className={`rp-fchip${it.on ? " is-on" : ""}`} aria-pressed={it.on} data-tip={it.label} onClick={(e) => click(it as FlyoutOption, e)}>
                                    {nodeOf.get(it.key)}
                                    {it.on && <Check size={12} className="rp-fchip-check" aria-hidden="true" />}
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
                {visible.length === 0 && <span className="rp-muted">{t("raidBoard.fly.none")}</span>}
            </div>
            {(pages.length > 1 || onText) && (
                <footer className="rp-fly-foot">
                    {pages.length > 1 && (
                        <span className="rp-fly-pager">
                            <button type="button" aria-label={t("raidBoard.fly.prev")} disabled={at === 0} onClick={() => setPage(at - 1)}><ChevronLeft size={14} /></button>
                            <span>{at + 1} / {pages.length}</span>
                            <button type="button" aria-label={t("raidBoard.fly.next")} disabled={at >= pages.length - 1} onClick={() => setPage(at + 1)}><ChevronRight size={14} /></button>
                        </span>
                    )}
                    {onText && (
                        <form className="rp-fly-text" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onText(text.trim()); setText(""); } }}>
                            <input value={text} maxLength={60} placeholder={textPlaceholder} aria-label={textPlaceholder} onChange={(e) => setText(e.target.value)} />
                            <button type="submit" aria-label={textPlaceholder} disabled={!text.trim()}><Plus size={14} /></button>
                        </form>
                    )}
                </footer>
            )}
        </div>
        </>,
        document.body,
    );
}
