export default [{
    files: ["src/**/*.js"],
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        globals: {
            console: "readonly",
            require: "readonly",
            module: "readonly",
            __dirname: "readonly",
            process: "readonly",
            setTimeout: "readonly",
            setInterval: "readonly",
        },
    },
    rules: {
        "no-unused-vars": "warn",
        "no-undef": "off",
        "no-console": "off",
        "consistent-return": "off",
        eqeqeq: ["error", "always"],
        indent: ["error", 4],
        "linebreak-style": ["error", "windows"],
        quotes: ["error", "double"],
        semi: ["error", "always"],
    },
}, ];