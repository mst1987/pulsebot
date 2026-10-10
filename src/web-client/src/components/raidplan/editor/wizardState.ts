// The state of the animation editor's action assistant (ActionWizard.tsx, design B): its step, what is chosen and the choices of
// that kind; `points` = a loop's way as it is clicked on the map.
type Pt = { x: number; y: number };
export type WizardWhat = "move" | "badge" | "fade" | "turn" | "loop" | "pulse";
export type Wizard = {
    step: "who" | "what" | "where";
    what: WizardWhat | "";
    badge: string;
    pulseToo: boolean;
    fade: "hide" | "show" | "half";
    deg: number;
    pulseOn: boolean;
    closed: boolean;
    points: Pt[];
};
/** A fresh assistant: with somebody picked it starts at "Was?", else at "Wer?". */
export function newWizard(picked: boolean): Wizard {
    return { step: picked ? "what" : "who", what: "", badge: "spell_shadow_bloodboil", pulseToo: true, fade: "hide", deg: 0, pulseOn: true, closed: true, points: [] };
}
/** Whether the chosen kind of action needs a place on the map ("Wohin?"). */
export const needsWhere = (w: WizardWhat | "") => w === "move" || w === "loop";
