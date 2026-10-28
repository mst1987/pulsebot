import { useEffect, useRef, useState } from "react";
import type { GameClass, ProfileCharacter } from "../../api";
import { Badge, WowIcon } from "../../components/ui";
import Popover from "../../components/ui/Popover";
import { classColorProps } from "../../components/character/ClassSpec";
import { MoreIcon, PlusIcon } from "../../components/ui/icons";
import { belowEndPosition, type Placement } from "../../lib/ui/popoverPosition";
import { classLabel, specLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";

// The tab row of "Mein Profil": [Meine Infos] first, then one tab per character
// of the shown version in the raider's own order (there is no main), [+] to add
// one, and for the orga "Alle Charaktere" at the end. On a desktop the row
// wraps; on a phone it scrolls sideways, and from MORE_FROM characters on a
// "⋯" button lists every tab (styles/profile.css .pf-tabbar).

export type ProfileTab = { kind: "info" } | { kind: "char"; key: string } | { kind: "all" };

/** From this many characters a phone gets the "⋯" list next to the scrolling row. */
export const MORE_FROM = 6;

const INFO_ICON = "tasks";

/**
 * Room the "⋯" list leaves free at the foot of the screen: the toasts sit there
 * (styles/feedback.css .toast-wrap, bottom 20 px) - "Du bist jetzt in Forever"
 * after a link to a character must not cover the list's last entries.
 */
const TOAST_ROOM = 96;

/** The "⋯" list under its button, right-aligned, scrolling above the toast strip. */
const MENU_PLACEMENT: Placement = (anchor, _box, viewport) => {
    if (!anchor) return {};
    return { ...belowEndPosition(anchor, viewport), maxHeight: Math.max(160, viewport.height - anchor.bottom - TOAST_ROOM) };
};

/** The icon a character's tab shows: its first spec's, else its class's. */
function tabIcon(c: ProfileCharacter, cls?: GameClass): string {
    return c.specs[0]?.icon || cls?.icon || "inv_misc_questionmark";
}

/** "Frost · Magier" — what the icon of a character's tab stands for. */
function tabTip(c: ProfileCharacter, cls: GameClass | undefined, noSpec: string): string {
    const spec = c.specs[0] ? specLabel(c.specs[0].key, c.specs[0].label) : noSpec;
    return `${spec} · ${classLabel(c.className, cls?.label || c.className)}`;
}

function CharTabLabel({ character, cls }: { character: ProfileCharacter; cls?: GameClass }) {
    const t = useT();
    const color = classColorProps(cls?.color);
    return (
        <>
            <WowIcon name={tabIcon(character, cls)} size={22} />
            {/* pf-tab-name: in light mode darker than the shared class colour (contrast >= 4.5:1, styles/profile.css) */}
            <span className={["pf-tab-name", color.className].filter(Boolean).join(" ")} style={color.style}>{character.name}</span>
            {character.claimedBy.length > 0 && (
                <span className="pf-tab-warn" data-tip={t("profile.char.claimed")} data-tip-sub={t("profile.char.claimedChip", { names: character.claimedBy.map((c) => c.name || t("profile.char.unknown")).join(", ") })}>!</span>
            )}
        </>
    );
}

export function ProfileTabs({ characters, classOf, current, orga, onSelect, onAdd }: {
    characters: ProfileCharacter[];
    classOf: (c: ProfileCharacter) => GameClass | undefined;
    current: ProfileTab;
    /** Shows "Alle Charaktere". */
    orga: boolean;
    onSelect: (tab: ProfileTab) => void;
    /** [+]: opens the add dialog; missing = no [+] (the orga's list is shown). */
    onAdd?: () => void;
}) {
    const t = useT();
    const [menu, setMenu] = useState(false);
    const moreRef = useRef<HTMLButtonElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const many = characters.length >= MORE_FROM;
    const is = (tab: ProfileTab) => tab.kind === current.kind && (tab.kind !== "char" || (current.kind === "char" && current.key === tab.key));
    const currentId = current.kind === "char" ? current.key : current.kind;

    // a deep link or the "⋯" list may pick a tab outside the scrolled part of the row
    useEffect(() => {
        const el = rowRef.current?.querySelector<HTMLElement>("[aria-selected=\"true\"]");
        el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }, [currentId]);

    const tabs: { tab: ProfileTab; id: string }[] = [
        { tab: { kind: "info" }, id: "info" },
        ...characters.map((c) => ({ tab: { kind: "char", key: c.key } as ProfileTab, id: c.key })),
        ...(orga ? [{ tab: { kind: "all" } as ProfileTab, id: "all" }] : []),
    ];
    const pick = (tab: ProfileTab) => { setMenu(false); onSelect(tab); };

    return (
        <div className={`pf-tabbar${many ? " pf-tabbar-many" : ""}`}>
            <div className="tabs pf-tabs" role="tablist" aria-label={t("profile.tabs.aria")} ref={rowRef}>
                <button type="button" role="tab" aria-selected={is({ kind: "info" })} className={`tab-btn pf-tab${is({ kind: "info" }) ? " active" : ""}`}
                    data-tip={t("profile.tabs.info")} data-tip-sub={t("profile.tabs.infoTip")} onClick={() => onSelect({ kind: "info" })}>
                    <WowIcon name={INFO_ICON} size={22} />
                    {t("profile.tabs.info")}
                </button>
                {characters.map((c) => {
                    const tab: ProfileTab = { kind: "char", key: c.key };
                    return (
                        <button key={c.key} type="button" role="tab" aria-selected={is(tab)} className={`tab-btn pf-tab${is(tab) ? " active" : ""}`}
                            data-tip={c.name} data-tip-sub={tabTip(c, classOf(c), t("profile.tabs.noSpec"))} onClick={() => onSelect(tab)}>
                            <CharTabLabel character={c} cls={classOf(c)} />
                        </button>
                    );
                })}
                {/* a tab of the row that is never selected: it opens the add dialog */}
                {onAdd && (
                    <button type="button" role="tab" aria-selected={false} className="tab-btn pf-tab pf-tab-add" aria-label={t("profile.addCharacter")}
                        data-tip={t("profile.addCharacter")} data-tip-sub={t("profile.tabs.addTip")} onClick={onAdd}>
                        <PlusIcon />
                    </button>
                )}
                {orga && (
                    <button type="button" role="tab" aria-selected={is({ kind: "all" })} aria-label={t("profile.tabs.all")} className={`tab-btn pf-tab pf-tab-all${is({ kind: "all" }) ? " active" : ""}`}
                        data-tip={t("profile.tabs.all")} data-tip-sub={t("profile.tabs.allTip")} onClick={() => onSelect({ kind: "all" })}>
                        {t("profile.tabs.all")}
                        <Badge size="sm">{t("profile.tabs.orga")}</Badge>
                    </button>
                )}
            </div>
            {many && (
                // a plain .ibtn: the Popover needs the button itself as its anchor
                <button ref={moreRef} type="button" className="ibtn pf-tab-more" aria-label={t("profile.tabs.more")} data-tip={t("profile.tabs.more")}
                    aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                    <MoreIcon />
                </button>
            )}
            {menu && (
                <Popover anchor={moreRef} place={MENU_PLACEMENT}onClose={() => setMenu(false)} className="pf-tabmenu" role="menu" aria-label={t("profile.tabs.more")}>
                    {tabs.map(({ tab, id }) => {
                        const c = tab.kind === "char" ? characters.find((x) => x.key === tab.key) : undefined;
                        return (
                            <button key={id} type="button" role="menuitemradio" aria-checked={is(tab)} className={`pf-tabmenu-item${is(tab) ? " is-on" : ""}`} onClick={() => pick(tab)}>
                                {c ? <CharTabLabel character={c} cls={classOf(c)} /> : (
                                    <>
                                        {tab.kind === "info" && <WowIcon name={INFO_ICON} size={22} />}
                                        {t(tab.kind === "info" ? "profile.tabs.info" : "profile.tabs.all")}
                                    </>
                                )}
                            </button>
                        );
                    })}
                </Popover>
            )}
        </div>
    );
}
