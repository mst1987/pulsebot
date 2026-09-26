import { useMemo, type CSSProperties } from "react";
import WowIcon from "./WowIcon";
import { classIconName } from "../../lib/rosterView";
import { classLabel } from "../../lib/wowNames";
import { t } from "../../i18n";
import { RAID_CONTENTS } from "../../lib/raidIcons";

// The one loading state of the menu: four classes going at a TBC raid boss.
// "Lade…" in grey said nothing and looked like a dead page; this says the same
// thing in the game's own vocabulary, and it is the SAME everywhere — the page
// bodies, the overlay of a long operation and the Loot-Council all render this.
//
// Purely decorative: WoW icons that are already mirrored for the rest of the
// menu (no new assets), a CSS animation, and nothing that moves under
// prefers-reduced-motion. The party and the boss are drawn once per mount, so
// the scene does not reshuffle while the page keeps rendering.

/** The classes that can turn up in the party — the icon table's own keys. */
const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];

/** How many of them fight. Four fits next to the boss at phone width too. */
const PARTY_SIZE = 4;

// One end boss per raid, with the icon the rest of the menu already uses for
// that raid (lib/raidIcons.ts — those names are checked against the CDN).
const BOSSES: { key: string; label: string }[] = [
    { key: "kara", label: "Malchezaar" },
    { key: "gruul", label: "Gruul" },
    { key: "mag", label: "Magtheridon" },
    { key: "ssc", label: "Lady Vashj" },
    { key: "tk", label: "Kael'thas" },
    { key: "za", label: "Zul'jin" },
    { key: "hyjal", label: "Archimonde" },
    { key: "bt", label: "Illidan" },
    { key: "swp", label: "Kil'jaeden" },
];

function pickParty(): string[] {
    const pool = [...CLASSES];
    const party: string[] = [];
    while (party.length < PARTY_SIZE && pool.length) {
        party.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
    }
    return party;
}

export default function RaidLoader({ text = t("common.loading"), compact = false }: {
    /** What is being waited for — one short line under the scene. */
    text?: string;
    /** Smaller, for a loading state inside a card instead of a whole page. */
    compact?: boolean;
}) {
    const { party, boss } = useMemo(() => ({
        party: pickParty(),
        boss: BOSSES[Math.floor(Math.random() * BOSSES.length)],
    }), []);

    return (
        <div className={`rl${compact ? " rl-compact" : ""}`} role="status" aria-live="polite">
            <div className="rl-stage" aria-hidden="true">
                <div className="rl-party">
                    {party.map((className, i) => (
                        <span key={className} className="rl-unit">
                            <span className="rl-name">{classLabel(className)}</span>
                            {/* every third one runs the wrong way — it is a raid, after all */}
                            <span
                                className={`rl-icon ${i % 3 === 1 ? "flee" : "attack"}`}
                                style={{ "--rl-delay": `${(i * 0.17).toFixed(2)}s` } as CSSProperties}
                            >
                                <WowIcon name={classIconName(className)} size={compact ? 26 : 34} />
                            </span>
                        </span>
                    ))}
                </div>
                <span className="rl-clash">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" /><path d="M13 19l6-6" /><path d="m16 16 4 4" />
                        <path d="M19 21h2v-2" /><path d="M9.5 6.5 21 18v3h-3L6.5 9.5" /><path d="M5 19l6-6" />
                        <path d="m8 16-4 4" /><path d="M5 21H3v-2" />
                    </svg>
                </span>
                <span className="rl-unit rl-boss">
                    <span className="rl-name">{boss.label}</span>
                    <span className="rl-icon">
                        <WowIcon name={RAID_CONTENTS[boss.key].icon} size={compact ? 38 : 52} />
                    </span>
                </span>
            </div>
            <div className="rl-caption">{text}</div>
        </div>
    );
}
