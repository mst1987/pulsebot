// Small pieces of the page "Dungeon-Bestzeiten": a medal as a square field
// with its word, and a player's name in the class colour.
import type { DungeonMedal, DungeonMember } from "../../api";
import { WowIcon } from "../../components/ui";
import { classColorProps } from "../../components/character/ClassSpec";
import { classLabel } from "../../lib/wow/wowNames";
import { useT } from "../../i18n";

/** Gold / Silber / Bronze as a small square in the medal's colour plus the word; a dash without one. */
export function Medal({ medal }: { medal: DungeonMedal | null }) {
    const t = useT();
    if (!medal) return <span className="dg-nomedal" data-tip={t("dungeons.medal.noneTip")}>{t("dungeons.medal.none")}</span>;
    return (
        <span className="dg-medal" data-medal={medal}>
            <i aria-hidden="true" />
            {t(`dungeons.medal.${medal}`)}
        </span>
    );
}

/** A player's name in the class colour, the class as the tooltip. */
export function MemberName({ member, icon = false }: { member: DungeonMember; icon?: boolean }) {
    const color = classColorProps(member.color);
    const label = member.classId ? classLabel(member.classId, member.classId) : "";
    return (
        <span className="dg-member" data-tip={label || undefined}>
            {icon && <WowIcon name={member.icon || "inv_misc_questionmark"} size={20} />}
            <b className={color.className} style={color.style}>{member.name}</b>
        </span>
    );
}
