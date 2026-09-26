import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import react from "eslint-plugin-react";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist"] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
            react,
            "jsx-a11y": jsxA11y,
        },
        settings: { react: { version: "detect" } },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
            "react/jsx-key": "error",
            ...jsxA11y.flatConfigs.recommended.rules,
            // Follow-up work (#415): these still have hits in the client, so they
            // stay off until the markup is fixed — switching them on as warnings
            // would blow the --max-warnings ratchet in ci.yml. Hits at the time:
            // no-array-index-key 55, no-noninteractive-tabindex 34,
            // label-has-associated-control 10, click-events-have-key-events 8,
            // no-static-element-interactions 8,
            // no-noninteractive-element-interactions 8, interactive-supports-focus 3,
            // aria-role 3, no-autofocus 1.
            "react/no-array-index-key": "off",
            "jsx-a11y/no-noninteractive-tabindex": "off",
            "jsx-a11y/label-has-associated-control": "off",
            "jsx-a11y/click-events-have-key-events": "off",
            "jsx-a11y/no-static-element-interactions": "off",
            "jsx-a11y/no-noninteractive-element-interactions": "off",
            "jsx-a11y/interactive-supports-focus": "off",
            "jsx-a11y/aria-role": "off",
            "jsx-a11y/no-autofocus": "off",
        },
    },
);
