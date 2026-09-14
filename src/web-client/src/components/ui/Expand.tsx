import { ChevronDownIcon } from "../icons";

// The one way to fold something open: "Details" plus a round 30-px chevron
// button that fills and turns when open — never a bare ▸ glyph, which was too
// small to find. Same look as expBtn() on the report pages.
export default function Expand({ open, onToggle, label = "Details", showLabel = true }: {
    open: boolean;
    onToggle: () => void;
    label?: string;
    showLabel?: boolean;
}) {
    return (
        <button type="button" className="exp-lbl" aria-expanded={open} aria-label={showLabel ? undefined : label} onClick={onToggle}>
            {showLabel && <span>{label}</span>}
            <span className={`exp${open ? " open" : ""}`} aria-hidden="true"><ChevronDownIcon /></span>
        </button>
    );
}
