import type { Lang } from "../../i18n/core";

// The examples in input hints ("e.g. Hyjal + Black Temple") come from the rule set of
// the game version (config/gameVersions), never from a fixed text: a Forever or Classic
// raid leader should not read TBC raids. `short` and `tag` are the same in every language.

type LangExamples = { raid: string; raids: string; item: string };
export type VersionExamples = { short: string; tag: string; de: LangExamples; en: LangExamples };
export type Examples = { short: string; tag: string; raid: string; raids: string };

/** Without a version (a page outside the shell) the hint stays true for every version. */
const NEUTRAL: Examples = { short: "Raid", tag: "raid", raid: "Raid", raids: "Raid" };

export function examplesFor(version: { examples?: VersionExamples } | null | undefined, lang: Lang): Examples {
    const examples = version?.examples;
    if (!examples) return NEUTRAL;
    const { raid, raids } = examples[lang] || examples.de;
    return { short: examples.short, tag: examples.tag, raid, raids };
}
