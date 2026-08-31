import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_NAME = "searchScopeFolderId";
const PERSISTENCE_MARKERS = ["localStorage", "sessionStorage", "indexedDB", "viewSetBandCollapsed", "viewSetMode"];

export function persistedScopeLines(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.includes(STATE_NAME) && PERSISTENCE_MARKERS.some((marker) => line.includes(marker)))
    .map((line) => line.trim());
}

const APP_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "App.tsx");

test("search_scope_is_never_persisted_in_app_state", () => {
  const source = readFileSync(APP_SOURCE_PATH, "utf-8");
  assert.deepEqual(persistedScopeLines(source), []);
});

test("scope_guard_flags_synthetic_persisted_scope", () => {
  const synthetic = 'localStorage.setItem("scope", String(searchScopeFolderId));';
  assert.ok(persistedScopeLines(synthetic).length > 0);
});
