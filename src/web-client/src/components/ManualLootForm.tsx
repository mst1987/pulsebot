// "Item nachtragen" — one award entered by hand, for what no export carried:
// a piece handed out after the raid, a night where nobody ran the addon, an
// item traded on afterwards.
//
// Two rules shape the form. The item is picked from the raid's own drop table
// (config/tbcContent.js via /api/history/loot-picker), never from a free
// Wowhead search — a Karazhan night cannot be credited with a Sunwell weapon
// that way. And the raider is picked from the characters the app already knows,
// class colour and all, so a typo does not silently open a second loot history
// under "Thrallx" next to "Thrall"; typing a name that is not in the list stays
// possible for a trial's first raid.
import { useEffect, useMemo, useRef, useState } from "react";
import {
    addLootItem, getLootPicker,
    type ApiError, type RaidDropItem, type LootPickerCharacter, type LootPickerData,
} from "../api";
import { itemQualityProps } from "../lib/itemQuality";
import { classColorProps } from "./ClassSpec";
import { useToast } from "./Jobs";

// Bosses that are not an encounter, in the order tbcContent.js files them.
const TRASH = "Trash";

// How many suggestions the raider picker drops down at once. The raider list is
// open-ended (everyone who ever got loot), so it is a "keep typing" hint.
//
// The item picker deliberately has NO such cap: its list is one raid's closed
// drop table, and scrolling it is how somebody who does not remember an item's
// exact name finds it. Capped at 12 it showed the alphabetically first boss and
// nothing else — "Alle Bosse" promised 223 items and offered a dozen.
const MAX_SUGGESTIONS = 12;

const norm = (s: string) => s.trim().toLowerCase();

// `datetime-local` wants "YYYY-MM-DDTHH:mm" in *local* time, which is exactly
// what toISOString() does not give — hence the manual assembly.
function toLocalInput(ms: number): string {
    const d = new Date(ms || Date.now());
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The drop-table picker: filtered as you type, never leaving the raid's loot. */
function ItemPicker({ items, value, onPick }: {
    items: RaidDropItem[];
    value: RaidDropItem | null;
    onPick: (item: RaidDropItem | null) => void;
}) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    // An empty query lists the raid's drops from the top rather than nothing:
    // the list is the point of the picker, and scrolling it is how somebody who
    // does not remember the item's exact name finds it. Never cut short — the
    // panel scrolls (.hr-panel), and a raid is 30-200 items, all of which the
    // browser renders without noticing. See MAX_SUGGESTIONS.
    const matches = useMemo(() => {
        const q = norm(query);
        if (!q) return items;
        return items.filter((it) => norm(it.name).includes(q) || String(it.id) === q);
    }, [items, query]);

    if (value) {
        return (
            <div className="row-actions" style={{ gap: 8 }}>
                {value.iconUrl && <img className="loot-ico" src={value.iconUrl} alt="" loading="lazy" />}
                <span {...itemQualityProps(value.quality)}>{value.name}</span>
                <span className="sub" style={{ margin: 0 }}>{value.boss || "ohne Boss"}</span>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => onPick(null)}>Anderes Item</button>
            </div>
        );
    }

    return (
        <div className="hr-picker" ref={rootRef}>
            <input
                type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                placeholder="Item aus diesem Raid suchen …" autoComplete="off"
                onFocus={() => setOpen(true)}
            />
            <div className={`hr-panel${open && matches.length ? " open" : ""}`}>
                {matches.map((it) => (
                    <div key={it.id} className="hr-row" onMouseDown={(e) => { e.preventDefault(); onPick(it); setQuery(""); setOpen(false); }}>
                        {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                        <span {...itemQualityProps(it.quality)}>{it.name}</span>
                        <span className="sub" style={{ margin: 0, marginLeft: "auto" }}>{it.boss || "—"}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** The raider picker: known characters first, free text still allowed. */
function RaiderPicker({ characters, roster, value, onChange }: {
    characters: LootPickerCharacter[];
    /** Names from this raid's signup/setup — offered before everyone else. */
    roster: string[];
    value: string;
    onChange: (name: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    // The raid's own roster first: the raider being credited was almost always
    // in the raid, and having them at the top is the difference between picking
    // a name and searching for one.
    const ordered = useMemo(() => {
        const inRaid = new Set(roster.map(norm));
        const rank = (c: LootPickerCharacter) => (inRaid.has(norm(c.character)) ? 0 : 1);
        const known = new Map(characters.map((c) => [norm(c.character), c]));
        // A roster name the loot history has never seen is still offered — the
        // trial who is about to get their first item is exactly that case.
        const extra = roster
            .filter((n) => n.trim() && !known.has(norm(n)))
            .map((n) => ({ character: n.trim(), className: "", spec: "", classColor: "", iconUrl: "" }));
        return [...characters, ...extra].sort((a, b) => rank(a) - rank(b) || a.character.localeCompare(b.character));
    }, [characters, roster]);

    const matches = useMemo(() => {
        const q = norm(value);
        const hits = q ? ordered.filter((c) => norm(c.character).includes(q)) : ordered;
        return hits.slice(0, MAX_SUGGESTIONS);
    }, [ordered, value]);

    const picked = ordered.find((c) => norm(c.character) === norm(value)) || null;

    return (
        <div className="hr-picker" ref={rootRef}>
            <input
                type="text" value={value} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
                placeholder="Charakternamen suchen oder eingeben …" autoComplete="off"
                onFocus={() => setOpen(true)}
                {...(picked ? classColorProps(picked.classColor) : {})}
            />
            <div className={`hr-panel${open && matches.length ? " open" : ""}`}>
                {matches.map((c) => (
                    <div
                        key={c.character} className="hr-row"
                        onMouseDown={(e) => { e.preventDefault(); onChange(c.character); setOpen(false); }}
                    >
                        {c.iconUrl
                            ? <img src={c.iconUrl} alt="" loading="lazy" />
                            : <span className="raider-badge-ico raider-badge-ico-ph" />}
                        <span {...classColorProps(c.classColor)}>{c.character}</span>
                        {!!c.className && (
                            <span className="sub" style={{ margin: 0, marginLeft: "auto" }}>
                                {c.spec ? `${c.spec} ${c.className}` : c.className}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function ManualLootForm({ eventId, eventTitle = "", defaultAwardedAt = 0, roster = [], csrfToken, onAdded }: {
    eventId: string;
    /** Used to guess which raid to open on when no loot is stored yet. */
    eventTitle?: string;
    /** The raid's start, so a nachgetragenes item lands on the right night. */
    defaultAwardedAt?: number;
    roster?: string[];
    csrfToken: string | null;
    onAdded: (msg: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [picker, setPicker] = useState<LootPickerData | null>(null);
    const [loadError, setLoadError] = useState("");
    const [contentId, setContentId] = useState("");
    const [boss, setBoss] = useState("");
    const [item, setItem] = useState<RaidDropItem | null>(null);
    const [character, setCharacter] = useState("");
    const [response, setResponse] = useState("");
    const [awardedAt, setAwardedAt] = useState(() => toLocalInput(defaultAwardedAt || Date.now()));
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    // Loaded on first open, not on mount: the catalogue is a raid's worth of
    // items and most visits to a loot tab never open this form.
    useEffect(() => {
        if (!open || picker) return;
        getLootPicker(eventId, eventTitle)
            .then((data) => {
                setPicker(data);
                setContentId(data.suggested[0] || data.contents[0]?.id || "");
                if (!response) setResponse((data.reasons.find((r) => r.id === "mainspec") || data.reasons[0])?.label || "");
            })
            .catch((err: ApiError) => setLoadError(err.message));
    }, [open, picker, eventId, eventTitle, response]);

    const content = picker?.contents.find((c) => c.id === contentId) || null;
    const bosses = useMemo(() => {
        const seen: string[] = [];
        for (const it of content?.items || []) if (!seen.includes(it.boss)) seen.push(it.boss);
        return seen;
    }, [content]);
    const items = useMemo(
        () => (content?.items || []).filter((it) => !boss || it.boss === boss),
        [content, boss],
    );

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!item || !character.trim()) return;
        setBusy(true);
        try {
            const reason = picker?.reasons.find((r) => r.label === response) || null;
            const r = await addLootItem(csrfToken, {
                event: eventId,
                itemId: item.id,
                character: character.trim(),
                boss: item.boss,
                instance: content?.label || "",
                response,
                offspec: reason?.id === "offspec",
                awardedAt: awardedAt ? new Date(awardedAt).getTime() : 0,
            });
            onAdded(`„${r.item.itemName || item.name}" für ${character.trim()} nachgetragen.`);
            // Only item and raider are cleared: nachtragen happens in batches
            // ("die drei Sachen vom Dienstag"), and raid, boss and time are the
            // same for all of them.
            setItem(null);
            setCharacter("");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <div className="row-actions" style={{ marginBottom: 18 }}>
                <button className="btn btn-ghost" type="button" onClick={() => setOpen(true)}>+ Item nachtragen</button>
            </div>
        );
    }

    return (
        <div className="dash-card" style={{ marginBottom: 18 }}>
            <div className="dash-card-head">
                <h3>Item nachtragen</h3>
                <button className="btn btn-sm btn-ghost" type="button" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>Schließen</button>
            </div>
            {loadError && <p className="note" style={{ margin: "12px 16px" }}>Auswahl konnte nicht geladen werden: {loadError}</p>}
            {!picker && !loadError && <p className="sub" style={{ padding: "12px 16px" }}>Lade Auswahl…</p>}
            {picker && (
                <form className="card-form" onSubmit={submit} style={{ padding: "14px 16px" }}>
                    <div className="field">
                        <label>Raid</label>
                        <select value={contentId} onChange={(e) => { setContentId(e.target.value); setBoss(""); setItem(null); }}>
                            {picker.contents.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                        </select>
                        <div className="hint">Zur Auswahl stehen nur Items, die in diesem Raid droppen können.</div>
                    </div>
                    <div className="field">
                        <label>Boss</label>
                        <select value={boss} onChange={(e) => { setBoss(e.target.value); setItem(null); }}>
                            <option value="">Alle Bosse</option>
                            {bosses.map((b) => (
                                <option key={b || "none"} value={b}>{b || "ohne Boss (Marken-Items)"}</option>
                            ))}
                        </select>
                        <div className="hint">{`${items.length} Item(s) zur Auswahl${boss === TRASH ? " (Trash-Drops)" : ""}.`}</div>
                    </div>
                    <div className="field">
                        <label>Item</label>
                        <ItemPicker items={items} value={item} onPick={setItem} />
                    </div>
                    <div className="field">
                        <label>Raider</label>
                        <RaiderPicker characters={picker.characters} roster={roster} value={character} onChange={setCharacter} />
                    </div>
                    <div className="field">
                        <label>Grund</label>
                        <select value={response} onChange={(e) => setResponse(e.target.value)}>
                            {picker.reasons.map((r) => (
                                <option key={r.id} value={r.label}>{r.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="field">
                        <label>Zeitpunkt</label>
                        <input type="datetime-local" value={awardedAt} onChange={(e) => setAwardedAt(e.target.value)} />
                        <div className="hint">Vorbelegt mit dem Raidtermin — bestimmt, unter welchem Abend das Item in der Historie steht.</div>
                    </div>
                    <div className="row-actions">
                        <button className="btn" type="submit" disabled={busy || !item || !character.trim()}>
                            {busy ? "Trägt ein…" : "Item hinzufügen"}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
