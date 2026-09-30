// "Als Text kopieren" of the Kaderplaner's setup view: one variant as text a
// raid lead pastes into Discord — the groups as numbered lists, then who has no
// group yet and the bench. Pure; texts from the i18n layer at call time.
import type { KaderClassDef, KaderPlayer, KaderRoster, KaderVariant } from "../../api";
import { t } from "../../i18n";
import { activeOf, className, specName, unassigned } from "./model";

export function setupText({ variant, roster, players, classes }: {
    variant: KaderVariant;
    roster: KaderRoster;
    players: Map<string, KaderPlayer>;
    classes: KaderClassDef[];
}): string {
    const line = (id: string): string => {
        const p = players.get(id);
        if (!p) return id;
        const a = activeOf(p);
        if (!a) return `@${p.displayName}`;
        const spec = specName(classes, a.mainSpec);
        return `${a.name} (${className(classes, a.className)}${spec ? ` · ${spec}` : ""}) @${p.displayName}`;
    };
    const out = [`**${roster.name} · ${variant.name}**`, ""];
    variant.groups.forEach((g, i) => {
        out.push(`**${t("kader.setup.group", { n: i + 1 })}**`);
        const ids = g.filter((x): x is string => !!x);
        if (!ids.length) out.push(t("kader.setup.emptyGroup"));
        ids.forEach((id, j) => out.push(`${j + 1}. ${line(id)}`));
        out.push("");
    });
    const rest = unassigned(roster, variant);
    if (rest.length) out.push(`**${t("kader.setup.withoutGroup")}:** ${rest.map(line).join(", ")}`, "");
    if (roster.bench.length) out.push(`**${t("kader.bench.title")}:** ${roster.bench.map(line).join(", ")}`);
    return out.join("\n").trim();
}
