import { Check } from "lucide-react";
import type { RaidplanPublicBoss } from "../../../../api";
import { sectionGroups } from "../../../../lib/raidplan/stage";
import { STRIP_MODES, type StripMode } from "../../../../lib/raidplan/sheetLayout";
import { useT } from "../../../../i18n";
import Switch from "../../../../components/ui/Switch";

const STRIP_LABEL: Record<StripMode, string> = { off: "raidBoard.stage.stripOff", top: "raidBoard.stage.stripTop", left: "raidBoard.stage.stripLeft" };

/**
 * "Alle N Abschnitte" of the stage bar (/p/<token>): every section of the plan in runs of one instance, each with its portrait and,
 * spelled out, whether the visitor has a task of his own there ("Aufgabe für dich", the old chip's dot) or the log shows the boss
 * killed ("besiegt", the old chip's check). A pick closes it; Esc and a click outside are the bar's useDismiss. At its foot "Nur für mich"
 * and "Boss-Leiste" (off, a row over the map, a column beside it: stage/BossStrip.tsx).
 */
export default function SectionMenu({ sections, selectedKey, mineKeys, killedKeys, label, head, onlyMine, strip, onPick }: {
    sections: RaidplanPublicBoss[];
    selectedKey: string;
    mineKeys: Set<string>;
    killedKeys?: Set<string>;
    label: (b: RaidplanPublicBoss) => string;
    /** the event's title and time over the list */
    head: string;
    /** "Nur für mich" for a visitor who stands in the plan; null = not offered */
    onlyMine: { on: boolean; toggle: () => void } | null;
    /** the extra boss strip and its switch */
    strip: { mode: StripMode; set: (mode: StripMode) => void };
    onPick: (key: string) => void;
}) {
    const t = useT();
    return (
        <div className="rp-sheet-menu" role="dialog" aria-label={t("raidBoard.stage.sectionsTitle")}>
            <div className="rp-sheet-menu-head">{head}</div>
            {sectionGroups(sections).map((run, i) => (
                <div key={`${run.instance}|${i}`} className="rp-sheet-menu-run">
                    {run.instance && <span className="rp-kicker">{run.instance}</span>}
                    {run.items.map((b) => {
                        const on = b.key === selectedKey;
                        const killed = !!killedKeys && killedKeys.has(b.key);
                        const mine = mineKeys.has(b.key);
                        return (
                            <button
                                key={b.key} type="button" className={`rp-sheet-menu-item${on ? " is-on" : ""}${killed ? " is-killed" : ""}`}
                                aria-current={on ? "true" : undefined} onClick={() => onPick(b.key)}
                            >
                                {b.iconUrl ? <img src={b.iconUrl} alt="" width={30} height={30} /> : <span className="rp-sheet-menu-ph" aria-hidden="true" />}
                                <span className="rp-sheet-menu-name">{label(b)}</span>
                                {killed && <span className="rp-sheet-tag rp-sheet-tag-killed"><Check size={12} strokeWidth={3} aria-hidden="true" />{t("raidBoard.stage.tagKilled")}</span>}
                                {!killed && mine && <span className="rp-sheet-tag rp-sheet-tag-mine">{t("raidBoard.stage.tagMine")}</span>}
                            </button>
                        );
                    })}
                </div>
            ))}
            {onlyMine && (
                <Switch className="rp-sheet-menu-only" tipHead={t("raidBoard.read.onlyMineTip")} checked={onlyMine.on} onChange={() => onlyMine.toggle()} label={t("raidBoard.read.onlyMine")} />
            )}
            <div className="rp-sheet-menu-strip" role="radiogroup" aria-label={t("raidBoard.stage.strip")}>
                <span>{t("raidBoard.stage.strip")}</span>
                <span className="rp-sheet-seg">
                    {STRIP_MODES.map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={strip.mode === m} className={strip.mode === m ? "is-on" : ""} onClick={() => strip.set(m)}>{t(STRIP_LABEL[m])}</button>
                    ))}
                </span>
            </div>
        </div>
    );
}
