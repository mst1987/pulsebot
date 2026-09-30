import WowIcon from "../ui/WowIcon";
import { classRefIcon } from "../../lib/raidplan/assign";
import { ANY } from "../../lib/raidplan/classRefs";
import RoleGlyph from "./RoleGlyph";

/** The icon of a class reference: the WoW class icon, and for "any <role>" (no class) the role's glyph. */
export default function ClassRefIcon({ classId, role, size = 18 }: { classId: string; role: string; size?: number }) {
    if (classId === ANY) return <RoleGlyph role={role || "dps"} size={size} />;
    return <WowIcon name={classRefIcon(classId, role)} size={size} />;
}
