// The colours of the Kaderplaner's answers (docs/kaderplaner.md), so an answer
// is recognised at a glance before it is read:
//   - the options of a weekday question (interview.ts isWeekdays) carry the
//     app's weekday colours — the tokens --day-<mo…so> the raider profile uses,
//     mapped by [data-day] in styles/shared.css;
//   - every other option of a single or multiple choice a colour of a small
//     palette (tokens --opt-<name>, mapped by [data-opt] in styles/kader.css):
//     its own when the question editor set one, else the next free one by
//     position. Free text stays plain.
// The colour is never the only signal: the label always stands beside it. Pure.
import type { KaderOption, KaderQuestion } from "../../api";
import { isWeekdays } from "./interview";

/** The palette, in the order "automatic" hands it out — the same list the server checks (kaderModel.js OPTION_COLORS). */
export const OPTION_COLORS = ["blue", "amber", "rose", "teal", "violet", "lime", "orange", "slate"] as const;
export type OptionColor = typeof OPTION_COLORS[number];

/** The weekday keys of the colour tokens, Monday first (the order isWeekdays checks). */
export const DAY_KEYS = ["mo", "di", "mi", "do", "fr", "sa", "so"] as const;

export function isOptionColor(value: unknown): value is OptionColor {
    return typeof value === "string" && (OPTION_COLORS as readonly string[]).includes(value);
}

/**
 * The colour of every option, in their order: its own, else the first palette
 * colour no option holds yet; once all are taken, by position.
 */
export function optionColors(options: Pick<KaderOption, "color">[]): OptionColor[] {
    const used = new Set<OptionColor>(options.map((o) => o.color).filter(isOptionColor));
    return options.map((o, i) => {
        if (isOptionColor(o.color)) return o.color;
        const free = OPTION_COLORS.find((c) => !used.has(c));
        if (free) {
            used.add(free);
            return free;
        }
        return OPTION_COLORS[i % OPTION_COLORS.length];
    });
}

/** What colours an option: a weekday, a palette colour, or nothing (free text, an unknown option). */
export type Tone = { day: string } | { opt: OptionColor } | null;

/** The tone of one option of a question. */
export function toneOf(question: KaderQuestion, optionId: string): Tone {
    if (question.type === "text") return null;
    const i = question.options.findIndex((o) => o.id === optionId);
    if (i < 0) return null;
    if (isWeekdays(question)) return { day: DAY_KEYS[i] };
    return { opt: optionColors(question.options)[i] };
}

/** The data attribute a tone sets on an element ([data-day] / [data-opt] give it --tone). */
export function toneAttrs(tone: Tone): { "data-day"?: string; "data-opt"?: string } {
    if (!tone) return {};
    return "day" in tone ? { "data-day": tone.day } : { "data-opt": tone.opt };
}
