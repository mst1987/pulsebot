import type { ReactNode } from "react";
import type { GameVersion, RoleRange } from "../api";
import { allowedSizes, instancesOf } from "../lib/raidTemplates";
import Segment from "./ui/Segment";
import Badge from "./ui/Badge";
import WowIcon from "./ui/WowIcon";
import { WarnIcon } from "./settingsUi";
import "../styles/raid-templates.css";

// The fields of a raid plan besides CompositionEditor, shared by the "Event
// anlegen" dialog (#261) and the Raid-Vorlagen editor (#266): instance chips from
// the rule set, the size segment, the melee/ranged ranges, the required buffs, a
// small number field and a switch row. Styled with the Raid-Vorlagen classes
// (rt-), so an event and a template look alike.

const FREE = "free";

/** A small label with its explanation in the tooltip. */
export function FieldLabel({ text, tip }: { text: string; tip?: string }) {
    return <span className="rt-flabel" data-tip={tip ? text : undefined} data-tip-sub={tip}>{text}</span>;
}

/** The instances of a version as icon chips; "Infos fehlen" marks an incomplete one. */
export function InstancePicker({ version, value, onToggle }: {
    version: GameVersion | null;
    value: string[];
    onToggle: (id: string) => void;
}) {
    const chosen = instancesOf(version, value);
    return (
        <div className="rt-field">
            <FieldLabel text="Instanzen" tip="Mehrere möglich, z. B. SSC + TK an einem Abend. Die Größen und der Vorschlag für Tanks und Heiler kommen aus dem Regelsatz." />
            <div className="rt-insts" role="group" aria-label="Instanzen">
                {(version?.instances || []).map((inst) => {
                    const on = value.includes(inst.id);
                    return (
                        <button key={inst.id} type="button" className={`rt-inst${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(inst.id)}
                            data-tip={inst.name} data-tip-sub={inst.status === "incomplete" ? "Infos fehlen: Bosse und Endboss sind noch nicht bekannt." : `${inst.sizes.join("/")} Spieler`}>
                            <WowIcon name={inst.icon} size={20} />{inst.short}
                            {inst.status === "incomplete" && <WarnIcon />}
                        </button>
                    );
                })}
            </div>
            {chosen.some((i) => i.status === "incomplete") && <Badge tone="mid" icon={<WarnIcon />}>Infos fehlen</Badge>}
        </div>
    );
}

/**
 * The allowed sizes of the chosen instances as a segment, plus "frei" with a
 * number field. `size` null = not set yet (a migrated template): nothing is
 * selected; an emptied free field reports null. `children` sit beside it (a
 * "Größe ergänzen" badge).
 */
export function SizePicker({ version, instanceIds, size, free, onFree, onSize, children }: {
    version: GameVersion | null;
    instanceIds: string[];
    size: number | null;
    free: boolean;
    onFree: (free: boolean) => void;
    onSize: (size: number | null) => void;
    children?: ReactNode;
}) {
    const sizes = allowedSizes(version, instanceIds);
    const isFree = free || (size !== null && !sizes.includes(size));
    return (
        <div className="rt-field">
            <FieldLabel text="Raidgröße" tip="Die erlaubten Größen der gewählten Instanzen. „frei“ für jede andere Größe bis 40. Ein Wechsel schlägt Tanks und Heiler neu vor." />
            <div className="rt-sizes">
                <Segment
                    size="sm"
                    ariaLabel="Raidgröße"
                    value={size === null && !free ? "" : (isFree ? FREE : String(size))}
                    onChange={(v) => {
                        if (v === FREE) { onFree(true); return; }
                        onFree(false);
                        onSize(Number(v));
                    }}
                    options={[...sizes.map((s) => ({ value: String(s), label: String(s) })), { value: FREE, label: "frei" }]}
                />
                {isFree && (
                    <input className="inp-sm rt-size-input" type="number" min={1} max={40} aria-label="Freie Raidgröße" value={size || ""}
                        onChange={(e) => onSize(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                )}
                {children}
            </div>
        </div>
    );
}

/** A small labelled number field (0–40 by default); empty = null. */
export function NumberInput({ id, label, value, onChange, placeholder = "–", max = 40 }: {
    id: string;
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    placeholder?: string;
    max?: number;
}) {
    return (
        <div className="rt-num-field">
            <label htmlFor={id}>{label}</label>
            <input id={id} className="inp-sm" type="number" min={0} max={max} value={value === null ? "" : value} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </div>
    );
}

/** Melee and ranged as optional "min – max" ranges; both empty = no target. */
export function RoleRanges({ melee, ranged, onChange, idPrefix }: {
    melee: RoleRange | null;
    ranged: RoleRange | null;
    onChange: (next: { melee: RoleRange | null; ranged: RoleRange | null }) => void;
    idPrefix: string;
}) {
    const row = (key: "melee" | "ranged", label: string, value: RoleRange | null) => {
        const set = (min: number | null, max: number | null) => {
            const range = min === null && max === null ? null : { min: min || 0, max };
            onChange({ melee, ranged, [key]: range });
        };
        return (
            <div className="rt-range">
                <span className="rt-range-lbl">{label}</span>
                <NumberInput id={`${idPrefix}-${key}-min`} label="min" value={value ? value.min : null} onChange={(min) => set(min, value ? value.max : null)} />
                <NumberInput id={`${idPrefix}-${key}-max`} label="max" value={value ? value.max : null} onChange={(max) => set(value ? value.min : null, max)} />
            </div>
        );
    };
    return (
        <div className="rt-ranges">
            {row("melee", "Nahkampf", melee)}
            {row("ranged", "Fernkampf", ranged)}
        </div>
    );
}

/** The version's raid and party buffs as icon toggles. */
export function BuffPicker({ version, value, onToggle }: { version: GameVersion | null; value: string[]; onToggle: (key: string) => void }) {
    const buffs = version ? [...version.raidBuffs, ...version.partyBuffs] : [];
    return (
        <div className="rt-field">
            <FieldLabel text="Pflicht-Buffs" tip="Buffs, die der Raid dabeihaben soll — der Setup-Vorschlag plant jemanden dafür ein und warnt, wenn keiner sie mitbringt." />
            <div className="rt-buffs">
                {buffs.map((b) => {
                    const on = value.includes(b.key);
                    return (
                        <button key={`${b.scope}-${b.key}`} type="button" className={`rt-buff${on ? " on" : ""}`} aria-pressed={on} onClick={() => onToggle(b.key)}
                            data-tip={b.label} data-tip-sub={b.scope === "party" ? "Gruppen-Buff" : "Raid-Buff"}>
                            <WowIcon name={b.icon} size={24} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** One labelled switch, its explanation in the tooltip. */
export function SwitchRow({ label, tip, checked, onChange }: { label: string; tip: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="switch-row" data-tip={label} data-tip-sub={tip}>
            <span className="switch">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
            {label}
        </label>
    );
}
