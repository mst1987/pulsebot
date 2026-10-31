import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SetupEditorData, StoredSetup } from "../../../api";
import { pingTextToSave, publishHint, setupState, GROUP_SIZE } from "../../../lib/signups/setupEditor";
import { belowEndPlacement } from "../../../lib/ui/popoverPosition";
import { useT } from "../../../i18n";
import { Button } from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import Popover from "../../../components/ui/overlay/Popover";
import WowIcon from "../../../components/ui/icons/WowIcon";
import { BenchIcon, ChevronDownIcon } from "../../../components/ui/icons/icons";
import { clock, dateTime, MAX_RAID_SIZE } from "./setupText";

/**
 * One entry of the bar's "Aktionen" menu. `on` marks a switch (fairness, the compact
 * view …): checked or not. `value` is a short figure on the right ("2 frei"), `tone`
 * lifts the one suggested step ("hot") or marks a destructive one ("danger").
 */
export type MoreItem = { id: string; label: string; sub: string; icon: string; on?: boolean; disabled?: boolean; value?: string; tone?: "hot" | "danger"; onSelect: () => void };

/** A heading inside the menu ("Raid", "Vorschlag" …): the entries below it belong together. */
export type MoreSection = { section: string };

/**
 * "Aktionen ▾" in the bar: everything that is not the evening's one action, in four
 * sections (Raid, Vorschlag, Posten und benachrichtigen, Ansicht) — split or add
 * raids, fill, confirm, propose anew, the switches, the ping text, the compact view
 * and the bench as a column. "sep" draws a line between kinds. Portalled like
 * "Event verwalten".
 */
export function MoreMenu({ items }: { items: (MoreItem | MoreSection | "sep")[] }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLDivElement>(null);
    return (
        <div className="se-more" ref={anchor}>
            <Button
                variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open}
                data-tip={open ? undefined : t("setup.editor.more")} data-tip-sub={open ? undefined : t("setup.editor.moreSub")}
                onClick={() => setOpen((o) => !o)}
            >
                {t("setup.editor.more")}<span className="se-more-chev" aria-hidden="true"><ChevronDownIcon /></span>
            </Button>
            {open && (
                <Popover anchor={anchor} place={belowEndPlacement()} follow="reposition" onClose={() => setOpen(false)} className="se-more-pop" role="menu">
                    {items.map((it, i) => {
                        if (it === "sep") return <div key={`sep-${i}`} className="se-more-sep" role="separator" />;
                        if ("section" in it) return <div key={`sec-${i}`} className="se-more-head" role="presentation">{it.section}</div>;
                        return (
                            <button
                                key={it.id} type="button" role={it.on === undefined ? "menuitem" : "menuitemcheckbox"}
                                aria-checked={it.on === undefined ? undefined : it.on}
                                className={["se-more-item", it.on ? "is-on" : "", it.tone ? `is-${it.tone}` : ""].filter(Boolean).join(" ")}
                                disabled={it.disabled}
                                onClick={() => { setOpen(false); it.onSelect(); }}
                            >
                                <WowIcon name={it.icon} size={24} />
                                <span className="se-more-text">
                                    <span className="se-more-label">{it.label}</span>
                                    <span className="se-more-sub">{it.sub}</span>
                                </span>
                                {it.on !== undefined
                                    ? <span className={`se-more-switch${it.on ? " is-on" : ""}`} aria-hidden="true" />
                                    : it.value && <span className="se-more-value">{it.value}</span>}
                            </button>
                        );
                    })}
                </Popover>
            )}
        </div>
    );
}

/** One icon toggle of the ping split: pressed with the go colour when on, grey and struck through when off. */
function PostToggle({ on, disabled, icon, label, sub, onChange }: { on: boolean; disabled: boolean; icon: ReactNode; label: string; sub: string; onChange: (on: boolean) => void }) {
    const t = useT();
    const state = `${label}: ${on ? t("setup.postOptions.on") : t("setup.postOptions.off")}`;
    return (
        <button
            type="button" className={`se-post-toggle ${on ? "is-on" : "is-off"}`} aria-pressed={on} aria-label={state}
            data-tip={state} data-tip-sub={sub} disabled={disabled}
            onClick={() => onChange(!on)}
        >
            {icon}
        </button>
    );
}

/**
 * The bar's ONE primary button as a split (#setup-bar, head variant B): the action
 * itself ("Setup posten", or "Alle pingen" once it is out) and two icon toggles for
 * what it sends along — DMs to the placed players and the bench in the message. On:
 * pressed, go-coloured icon; off: grey and struck through. Their state is in the
 * icon, the tooltip and `aria-pressed`, so nothing hides in a menu. `options`
 * missing (no channel to post to, cancelled): the button alone.
 */
export function PostSplit({ button, options }: {
    button: ReactNode;
    options?: { bench: boolean; dms: boolean; disabled: boolean; dmsTip: string; onBench: (on: boolean) => void; onDms: (on: boolean) => void };
}) {
    const t = useT();
    if (!options) return <>{button}</>;
    return (
        <div className="split se-post-split" role="group" aria-label={t("setup.postOptions.aria")}>
            {button}
            <PostToggle
                on={options.dms} disabled={options.disabled} icon={<WowIcon name="message" size={20} />}
                label={t("setup.postOptions.dms")} sub={options.dmsTip} onChange={options.onDms}
            />
            <PostToggle
                on={options.bench} disabled={options.disabled} icon={<BenchIcon />}
                label={t("setup.postOptions.bench")} sub={t("setup.postOptions.benchSub")} onChange={options.onBench}
            />
        </div>
    );
}

/** One count of the bar as a square field ("Tanks 1/2", "8/10 Plätze"), toned by its check: green met, amber short, red nothing yet. */
export type BarCount = { key: string; text: ReactNode; tone: "ok" | "mid" | "bad" | "plain"; tip: string; tipSub?: string };

/** The bar's counts: square fields that wrap as a whole, never cut off. */
export function BarCounts({ counts }: { counts: BarCount[] }) {
    const t = useT();
    return (
        <span className="se-counts" role="list" aria-label={t("setup.bar.countsAria")}>
            {counts.map((c) => (
                <span key={c.key} role="listitem" className={`se-count-chip se-tone-${c.tone}`} data-tip={c.tip} data-tip-sub={c.tipSub}>{c.text}</span>
            ))}
        </span>
    );
}

/**
 * The raid size, editable right in the bar (#354): a change reshuffles groups
 * and bench live in the browser (`resizeLineup`), then commits — on blur or
 * Enter, not per keystroke, so a half-typed number never triggers a reshuffle.
 * "Unsaved" shows for the moment the typed value differs from what is stored.
 */
export function SizeControl({ size, disabled, onCommit }: { size: number; disabled: boolean; onCommit: (size: number) => void }) {
    const t = useT();
    // the size is entered as a number of groups; the total (groups times 5) is calculated
    const groups = Math.max(1, Math.ceil(size / GROUP_SIZE));
    const maxGroups = Math.floor(MAX_RAID_SIZE / GROUP_SIZE);
    const [text, setText] = useState(String(groups));
    useEffect(() => setText(String(groups)), [groups]);
    const parsed = Math.round(Number(text));
    const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed >= 1 && parsed <= maxGroups;
    const dirty = valid && parsed !== groups;
    const commit = () => {
        if (valid && parsed !== groups) onCommit(parsed * GROUP_SIZE);
        else setText(String(groups));
    };
    return (
        <label className="se-size" data-tip={t("setup.editor.sizeTip")} data-tip-sub={t("setup.editor.sizeSub")}>
            <span className="kicker">{t("setup.editor.sizeLabel")}</span>
            <input
                type="number" min={1} max={maxGroups} step={1} value={text} disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                aria-label={t("setup.editor.sizeLabel")}
            />
            <span className="se-size-total">{t("setup.editor.sizeTotal", { size: (valid ? parsed : groups) * GROUP_SIZE, perGroup: GROUP_SIZE })}</span>
            {dirty && <span className="se-size-dirty" data-tip={t("setup.editor.sizeUnsavedTip")}>{t("setup.editor.sizeUnsaved")}</span>}
        </label>
    );
}

/**
 * The setup's ONE state, first in the bar (`setupState`): "Entwurf", "Freigegeben ·
 * nicht gepostet", "Gepostet · Stand 2" … — never "Gepostet" beside "noch nicht
 * gepostet". What the post will do or did (the old line under the bar, #290:
 * channel, DMs, failures, an outdated message) is its tooltip; while the DMs run
 * the badge says so.
 */
export function StatusBadge({ setup, publish }: { setup: StoredSetup; publish: SetupEditorData["publish"] }) {
    const t = useT();
    const state = setupState(setup, publish);
    const hint = publishHint(publish, setup.status === "approved", clock);
    const lines: string[] = [];
    if (hint) lines.push(hint.text);
    if (state.key === "draft") {
        lines.push(t("setup.status.draftSub"));
        if (setup.origin === "auto") lines.push(setup.updatedAt ? t("setup.status.autoSubAt", { time: dateTime(setup.updatedAt) }) : t("setup.status.autoSub"));
    } else if (state.key === "changed") {
        lines.push(setup.approved ? t("setup.status.changedSubSince", { time: dateTime(setup.approved.approvedAt) }) : t("setup.status.changedSub"));
    } else if (state.key === "posted" && setup.approvedAt) {
        lines.push(t("setup.status.approvedSubSince", { time: dateTime(setup.approvedAt) }));
    }
    if (hint && hint.sub) lines.push(hint.sub);
    const label = hint && hint.running ? `${state.label} · ${t("setup.state.dmsRunning")}` : state.label;
    return (
        <Badge tone={state.tone} className="se-state" tip={state.label} tipSub={lines.filter(Boolean).join("\n")}>
            {label}
        </Badge>
    );
}

/**
 * The text everyone placed gets pinged with when the setup is posted (matches
 * the "Ping everyone" modal on the Discord side) — a minor, always-visible
 * supplementary control. Commits on blur or Enter, never per keystroke.
 */
export function PingTextField({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (text: string) => void }) {
    const t = useT();
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = () => {
        const next = pingTextToSave(draft, value);
        if (next !== null) onSave(next);
    };
    return (
        <div className="se-pingtext">
            <span className="se-pingtext-label" data-tip={t("setup.pingText.tip")}>
                📢 {t("setup.pingText.title")}
            </span>
            <input
                type="text"
                className="se-pingtext-input"
                value={draft}
                maxLength={300}
                disabled={disabled}
                aria-label={t("setup.pingText.label")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
            />
            <span className="se-pingtext-hint">{t("setup.pingText.hint")}</span>
        </div>
    );
}
