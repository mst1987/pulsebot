// An emoji picker like Discord's: a button beside a field opens a panel with a
// search, one tab per section and the emojis as a grid; the footer names the
// emoji under the pointer or the focus. Sections the caller passes (the raid's
// suggestions, what the category uses) come first, then "zuletzt benutzt",
// then Unicode's groups. The emoji data (lib/discord/emoji.ts) is downloaded when the
// panel opens for the first time, never with the page.
//
// Keyboard: the search has the focus when it opens, ArrowDown moves into the
// grid, the arrows move through it (nine to a row), Enter or Space picks,
// Escape closes and the focus returns to the button.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLang, useT } from "../../i18n";
import { EMOJI_GROUPS, emojiKey, loadEmojis, readRecentEmojis, rememberEmoji, searchEmojis, type Emoji } from "../../lib/discord/emoji";
import { panelPlacement } from "../../lib/ui/popoverPosition";
import Popover from "./Popover";

/** A row of emojis the caller puts on top ("Passt zu Zul'Aman"). */
export type EmojiSection = { key: string; label: string; emojis: string[] };

/** Emojis to a row in the grid; the arrow keys count with it. */
export const EMOJI_COLUMNS = 9;

const place = panelPlacement(360, 430);

export default function EmojiPicker({ onPick, sections = [], label, current = "", hint, host = "body", disabled = false }: {
    onPick: (emoji: string) => void;
    sections?: EmojiSection[];
    /** The button's accessible name and tooltip ("Emoji für den Kanalnamen"). */
    label: string;
    /** The emoji the field has now: shown on the button and marked in the grid. */
    current?: string;
    /** One line in the footer while nothing is hovered (what a pick does). */
    hint?: ReactNode;
    host?: "body" | "dialog";
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const close = () => {
        setOpen(false);
        anchor.current?.focus();
    };
    const pick = (emoji: string) => {
        rememberEmoji(emoji);
        close();
        onPick(emoji);
    };
    return (
        <>
            <button ref={anchor} type="button" className={`emo-trigger${open ? " is-open" : ""}`} disabled={disabled}
                aria-label={label} aria-haspopup="dialog" aria-expanded={open} data-tip={label}
                onClick={() => setOpen((o) => !o)}>
                {current ? <span className="emo-glyph" aria-hidden="true">{current}</span> : <SmileIcon />}
            </button>
            {open && (
                <Popover anchor={anchor} place={place} onClose={close} host={host} follow="reposition" className="emo-panel" role="dialog" aria-label={label}>
                    <EmojiPanel sections={sections} current={current} hint={hint} onPick={pick} onEscape={close} />
                </Popover>
            )}
        </>
    );
}

function SmileIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
            <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
        </svg>
    );
}

type Shown = { key: string; label: string; icon: string; emojis: Emoji[] };

/** The panel itself: search, tabs, the sections, the footer. */
export function EmojiPanel({ sections, current, hint, onPick, onEscape }: {
    sections: EmojiSection[];
    current: string;
    hint?: ReactNode;
    onPick: (emoji: string) => void;
    onEscape: () => void;
}) {
    const t = useT();
    const lang = useLang();
    const [data, setData] = useState<Emoji[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState("");
    const [focused, setFocused] = useState<Emoji | null>(null);
    const search = useRef<HTMLInputElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const heads = useRef(new Map<string, HTMLElement>());
    const [recent] = useState(readRecentEmojis);

    useEffect(() => {
        let alive = true;
        loadEmojis(lang).then((list) => alive && setData(list), () => alive && setFailed(true));
        return () => { alive = false; };
    }, [lang]);

    useEffect(() => { search.current?.focus(); }, []);

    const byKey = useMemo(() => new Map((data || []).map((e) => [emojiKey(e.e), e])), [data]);
    const known = (e: string): Emoji => byKey.get(emojiKey(e)) || { e, label: e, tags: [], group: -1 };

    const shown: Shown[] = useMemo(() => {
        if (!data) return [];
        if (query.trim()) return [{ key: "search", label: t("emoji.results"), icon: "", emojis: searchEmojis(data, query) }];
        const own = [...sections, { key: "recent", label: t("emoji.recent"), emojis: recent }]
            .filter((s) => s.emojis.length)
            .map((s) => ({ key: s.key, label: s.label, icon: s.emojis[0], emojis: s.emojis.map(known) }));
        const groups = EMOJI_GROUPS.map((g) => ({ key: g.key, label: t(`emoji.groups.${g.key}`), icon: g.icon, emojis: data.filter((e) => e.group === g.id) }));
        return [...own, ...groups];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, query, sections, recent, t]);

    const jump = (key: string) => {
        const head = heads.current.get(key);
        const box = scroller.current;
        if (head && box) box.scrollTop = head.offsetTop - box.offsetTop;
    };

    const cells = () => Array.from(scroller.current ? scroller.current.querySelectorAll<HTMLButtonElement>("button.emo-cell") : []);
    const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const list = cells();
        const at = list.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) return;
        const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: EMOJI_COLUMNS, ArrowUp: -EMOJI_COLUMNS };
        if (e.key === "Escape") {
            e.preventDefault();
            onEscape();
            return;
        }
        if (!(e.key in step)) return;
        e.preventDefault();
        const to = at + step[e.key];
        if (to < 0) {
            search.current?.focus();
            return;
        }
        list[Math.min(to, list.length - 1)]?.focus();
    };
    const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            cells()[0]?.focus();
        } else if (e.key === "Enter") {
            // Enter in the search picks the first hit, as in Discord
            e.preventDefault();
            const first = shown[0]?.emojis[0];
            if (query.trim() && first) onPick(first.e);
        } else if (e.key === "Escape") {
            e.preventDefault();
            onEscape();
        }
    };

    const currentKey = emojiKey(current);
    let firstCell = true;
    return (
        <div className="emo-box">
            <div className="emo-search">
                <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
                    placeholder={t("emoji.search")} aria-label={t("emoji.searchLabel")} />
            </div>
            {!query.trim() && shown.length > 0 && (
                <div className="emo-tabs" role="toolbar" aria-label={t("emoji.sections")}>
                    {shown.map((s) => (
                        <button key={s.key} type="button" className="emo-tab" aria-label={s.label} data-tip={s.label} onClick={() => jump(s.key)}>
                            <span aria-hidden="true">{s.icon}</span>
                        </button>
                    ))}
                </div>
            )}
            <div ref={scroller} className="emo-scroll" onKeyDown={onGridKey}>
                {failed && <p className="emo-note">{t("emoji.loadError")}</p>}
                {!failed && !data && <p className="emo-note">{t("emoji.loading")}</p>}
                {shown.map((s) => (
                    <section key={s.key} aria-label={s.label}>
                        <h4 className="emo-head" ref={(el) => { if (el) heads.current.set(s.key, el); else heads.current.delete(s.key); }}>{s.label}</h4>
                        {s.emojis.length
                            ? (
                                <div className="emo-grid">
                                    {s.emojis.map((emoji) => {
                                        const tab = firstCell ? 0 : -1;
                                        firstCell = false;
                                        const isCurrent = !!currentKey && emojiKey(emoji.e) === currentKey;
                                        return (
                                            <button key={emoji.e} type="button" tabIndex={tab} className={`emo-cell${isCurrent ? " is-current" : ""}`}
                                                aria-label={emoji.label} aria-pressed={isCurrent}
                                                onMouseEnter={() => setFocused(emoji)} onFocus={() => setFocused(emoji)}
                                                onClick={() => onPick(emoji.e)}>
                                                {emoji.e}
                                            </button>
                                        );
                                    })}
                                </div>
                            )
                            : <p className="emo-note">{t("emoji.none")}</p>}
                    </section>
                ))}
            </div>
            <div className="emo-foot" aria-live="polite">
                {focused
                    ? <><span className="emo-big" aria-hidden="true">{focused.e}</span><span className="emo-name">{focused.label}</span></>
                    : <span className="emo-hint">{hint}</span>}
            </div>
        </div>
    );
}
