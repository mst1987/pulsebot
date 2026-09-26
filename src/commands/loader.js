// The one place that reads src/commands/ (#413): the bot routes with it
// (`src/bot.js` loadCommands) and `scripts/register-commands.js` collects the
// slash-command definitions with it, so both always see the same modules.
//
// Every subfolder's `.js` files are modules, keyed by their `name`. Files
// directly in src/commands/ (this loader, shared factories) and folders
// starting with "_" are not. Two modules with the same name are an error —
// the second one used to replace the first without a word.
const fs = require("fs");
const path = require("path");
const { Collection } = require("discord.js");

const COMMANDS_DIR = __dirname;

/**
 * What a module is: a "command" carries `data` (the definition Discord gets —
 * slash command or context menu), a "component" is a button, select or modal
 * routed by its customId prefix. Commands can be reached from buttons too
 * (the overview buttons call `update-events` etc.), components never from a
 * slash command.
 */
function kindOf(module) {
    return module && module.data ? "command" : "component";
}

/** The module files: `[relativePath, absolutePath]`, folders and files sorted. */
function commandFiles(dir = COMMANDS_DIR) {
    const out = [];
    for (const folder of fs.readdirSync(dir).sort()) {
        const folderPath = path.join(dir, folder);
        if (folder.startsWith("_") || !fs.statSync(folderPath).isDirectory()) continue;
        for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith(".js")).sort()) {
            out.push([`${folder}/${file}`, path.join(folderPath, file)]);
        }
    }
    return out;
}

/** Every module by name; throws on a module without a name or a name used twice. */
function loadCommandModules(dir = COMMANDS_DIR) {
    const modules = new Collection();
    const seen = new Map();
    for (const [rel, file] of commandFiles(dir)) {
        const command = require(file);
        if (!command || !command.name) throw new Error(`Command module ${rel} exports no name.`);
        if (seen.has(command.name)) {
            throw new Error(`Duplicate command name "${command.name}" in ${seen.get(command.name)} and ${rel}.`);
        }
        seen.set(command.name, rel);
        modules.set(command.name, command);
    }
    return modules;
}

/** A module's definition as Discord wants it: a builder's toJSON(), else the plain object. */
function definitionOf(command) {
    const data = command.data;
    return typeof data.toJSON === "function" ? data.toJSON() : data;
}

/** The definitions of every command (modules with `data`), in load order. */
function commandDefinitions(modules = loadCommandModules()) {
    return [...modules.values()].filter((m) => kindOf(m) === "command").map(definitionOf);
}

module.exports = { COMMANDS_DIR, kindOf, commandFiles, loadCommandModules, definitionOf, commandDefinitions };
