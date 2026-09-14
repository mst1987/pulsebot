import WowIcon from "./ui/WowIcon";
import Badge, { type Tone } from "./ui/Badge";

// A secondary navigation for a page that holds more sections than a single tab
// row can carry legibly: a narrow column of entries with a heading per group,
// the same idiom as the shell's sidebar (.menu-label / .nav-item), one level in.
// Each entry leads with its WoW icon and may carry a round count badge for
// what is open there ("1 Verbindung fehlt"), so nobody has to open every section
// to find the one that needs attention.
//
// Below the layout breakpoint it turns into a wrapping row of chips — the group
// headings stay, each taking its own line, so the grouping survives on a phone.

export type NavBadge = { count: number; tone?: Tone; tip?: string };
export type NavEntry = { id: string; label: string; icon?: string; badge?: NavBadge | null };
export type NavGroup = { group: string; items: NavEntry[] };

export default function SectionNav({ groups, active, onSelect, ariaLabel }: {
    groups: NavGroup[];
    active: string;
    onSelect: (id: string) => void;
    ariaLabel: string;
}) {
    return (
        <nav className="section-nav" aria-label={ariaLabel}>
            {groups.map(({ group, items }) => (
                <div className="section-nav-group" key={group}>
                    <div className="section-nav-label">{group}</div>
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`section-nav-item${active === item.id ? " active" : ""}`}
                            aria-current={active === item.id ? "true" : undefined}
                            onClick={() => onSelect(item.id)}
                        >
                            {item.icon && <WowIcon name={item.icon} size={24} />}
                            <span className="section-nav-text">{item.label}</span>
                            {item.badge && item.badge.count > 0 && (
                                <Badge count tone={item.badge.tone} tip={item.badge.tip}>{item.badge.count}</Badge>
                            )}
                        </button>
                    ))}
                </div>
            ))}
        </nav>
    );
}
