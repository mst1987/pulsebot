// One home for the menu's own line icons (#439): components/icons.tsx. The
// settings module and the loot filters used to carry their own copies of
// EyeIcon, LockIcon, PlusIcon and InfoIcon; the raid plan draws with
// lucide-react. This keeps a second definition of a shared icon from coming back.
const fs = require("fs");
const path = require("path");
const { CLIENT, read } = require("./i18nHelper");

const icons = read("components/icons.tsx");
const shared = [...icons.matchAll(/^export function (\w+Icon)\(/gm)].map((m) => m[1]);

function clientFiles(dir = CLIENT, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) clientFiles(p, out);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
}

describe("components/icons.tsx", () => {
    it("has the icons that used to be duplicated", () => {
        for (const name of ["EyeIcon", "LockIcon", "PlusIcon", "InfoIcon"]) expect(shared).toContain(name);
    });

    it("no other file defines an icon of the shared set again", () => {
        const dupes = [];
        for (const file of clientFiles()) {
            if (file.endsWith(path.join("components", "icons.tsx"))) continue;
            const src = fs.readFileSync(file, "utf8");
            for (const name of shared) {
                if (new RegExp(`function ${name}\\(`).test(src)) dupes.push(`${path.relative(CLIENT, file)}: ${name}`);
            }
        }
        expect(dupes).toEqual([]);
    });

    it("the settings module and the loot filters take theirs from it", () => {
        expect(read("components/RolePermissions.tsx")).toMatch(/import \{[^}]*\bEyeIcon\b[^}]*\} from "\.\/icons";/);
        expect(read("components/BotCommandAccess.tsx")).toMatch(/import \{[^}]*\bLockIcon\b[^}]*\} from "\.\/icons";/);
        expect(read("components/SettingsRoleSync.tsx")).toMatch(/import \{[^}]*\bPlusIcon\b[^}]*\} from "\.\/icons";/);
        expect(read("components/LootFilters.tsx")).toMatch(/import \{[^}]*\bInfoIcon\b[^}]*\} from "\.\/icons";/);
        expect(read("components/LootInboxTab.tsx")).toMatch(/import \{[^}]*\bInfoIcon\b[^}]*\} from "\.\/icons";/);
    });
});
