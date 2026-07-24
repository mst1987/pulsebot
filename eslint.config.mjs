export default [
  {
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
      // Line endings are left to Git (core.autocrlf) + the editor, not ESLint:
      // git stores LF blobs, so a fixed "windows" rule fails the Linux CI while a
      // "unix" rule fails local Windows checkouts. So linebreak-style stays off.
      "linebreak-style": "off",
      quotes: ["error", "double"],
      semi: ["error", "always"],
    },
  },
];
