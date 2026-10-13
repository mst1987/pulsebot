import Badge from "../ui/Badge";
import { useT } from "../../i18n";

// "PuG" beside a raid whose category is open to everyone — no raider role, no
// roster-only signup (the server's `openToAll`, src/services/signups/signupAccess.js).
// Never guessed from a name. Small, so it sits in a row's sub line.
export default function PugBadge({ open }: { open?: boolean }) {
    const t = useT();
    if (!open) return null;
    return <Badge size="sm" className="pug-badge" tip={t("signups.pug.tip")}>{t("signups.pug.label")}</Badge>;
}
