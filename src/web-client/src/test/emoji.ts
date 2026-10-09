// A few real emojis instead of all ~1,700 for the picker's component tests:
// rendering the whole grid in every test is slow enough to time out under the
// full suite's load. Names and groups stay emojibase's own (lib/discord/emoji.ts).
// Only a type import from lib/discord/emoji: the tests mock that module and load this
// file from the mock's factory, so a real import would wait for itself.
import type { Emoji } from "../lib/discord/emoji";

const FEW = ["😀", "😂", "🐻", "🦅", "🐆", "🐉", "🌴", "🗿", "🐍", "🔥", "💀", "🌳", "🧸", "❤", "🏁"];

/** The test's share of the real list. */
export function fewEmojis(list: Emoji[]): Emoji[] {
    return list.filter((e) => FEW.includes(e.e.replace(/️/g, "")));
}
