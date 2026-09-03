#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));

const FROM = args.from || "Magpie";
const TO = args.to;
const ID_FROM = args["id-from"] || "com.stillmvd.magpie";
const ID_TO = args.id || ID_FROM;
const APPLY = args.apply === true;
const MIGRATE = args["migrate-data"] === true;

if (!TO) {
  console.log(`usage: node scripts/rename-project.mjs --to=NewName [--from=Magpie] [--id=com.x.newname] [--apply] [--migrate-data]
  dry-run by default; --apply writes; --migrate-data copies %LOCALAPPDATA%\\<old id> to <new id> and renames the .db
  the new name must have no spaces and must not match a known game (Discord overlay detects by process name)`);
  process.exit(1);
}
if (/\s/.test(TO)) { console.error("name must not contain spaces (auto-launch writes the Run path unquoted)"); process.exit(1); }

const SKIP_DIRS = new Set(["node_modules", "target", ".git", "dist", "gen", ".vite", ".agents", ".unlazy", ".planning", ".impeccable"]);
const TEXT_EXT = new Set([".ts", ".tsx", ".rs", ".toml", ".json", ".html", ".css", ".md", ".svg", ".mjs", ".cjs", ".js", ".lock", ".yml", ".yaml", ".txt", ".nsi", ".xml"]);

const variants = [
  [FROM, TO],
  [FROM.toLowerCase(), TO.toLowerCase()],
  [FROM.toUpperCase(), TO.toUpperCase()],
];
const wordRe = (w) => new RegExp(`(?<![A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "g");

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const report = { files: [], renames: [] };
for (const file of walk(root)) {
  if (!TEXT_EXT.has(path.extname(file))) continue;
  let text = fs.readFileSync(file, "utf8");
  let next = text;
  if (ID_TO !== ID_FROM) next = next.split(ID_FROM).join(ID_TO);
  let hits = 0;
  for (const [a, b] of variants) next = next.replace(wordRe(a), () => { hits++; return b; });
  if (next !== text) {
    report.files.push({ file: path.relative(root, file), hits });
    if (APPLY) fs.writeFileSync(file, next);
  }
}
for (const file of [...walk(root)].sort((a, b) => b.length - a.length)) {
  const base = path.basename(file);
  let renamed = base;
  for (const [a, b] of variants) renamed = renamed.replace(wordRe(a), b);
  if (renamed !== base) {
    report.renames.push(`${path.relative(root, file)} -> ${renamed}`);
    if (APPLY) fs.renameSync(file, path.join(path.dirname(file), renamed));
  }
}

console.log(`${APPLY ? "applied" : "dry-run"}: ${FROM} -> ${TO}, id ${ID_FROM} -> ${ID_TO}`);
for (const f of report.files) console.log(`  ${f.file} (${f.hits})`);
for (const r of report.renames) console.log(`  rename ${r}`);

if (MIGRATE && ID_TO !== ID_FROM) {
  const local = process.env.LOCALAPPDATA;
  const src = path.join(local, ID_FROM);
  const dst = path.join(local, ID_TO);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    console.log(`  data: ${src} -> ${dst}`);
    if (APPLY) {
      fs.cpSync(src, dst, { recursive: true });
      for (const suffix of [".db", ".db-wal", ".db-shm"]) {
        const oldDb = path.join(dst, `${FROM.toLowerCase()}${suffix}`);
        if (fs.existsSync(oldDb)) fs.renameSync(oldDb, path.join(dst, `${TO.toLowerCase()}${suffix}`));
      }
    }
  }
}

console.log(`
after --apply:
  1. cargo update -p ${TO.toLowerCase()} --manifest-path src-tauri/Cargo.toml   (refreshes Cargo.lock names)
  2. re-check: autostart Run key, single-instance, taskkill recipes in .claude/CLAUDE.md
  3. brand/ assets and icons are renamed but not redrawn`);
