import test from "node:test";
import assert from "node:assert/strict";

import { maximizeLabel, settingsHint, settingsLabel, updateMark } from "./titlebar.ts";

test("settings label mentions the version only when there is one", () => {
  assert.equal(settingsLabel("0.1.8"), "Настройки, доступна версия 0.1.8");
  assert.equal(settingsLabel(null), "Настройки");
  assert.equal(settingsLabel(undefined), "Настройки");
  assert.equal(settingsLabel("   "), "Настройки");
  assert.equal(settingsLabel(" 0.1.8 "), "Настройки, доступна версия 0.1.8");
});

test("settings hint appears only with a version", () => {
  assert.equal(settingsHint("0.1.8"), "Доступна версия 0.1.8");
  assert.equal(settingsHint(null), undefined);
  assert.equal(settingsHint(""), undefined);
  assert.equal(settingsHint(" "), undefined);
});

test("update mark drops blank versions", () => {
  assert.equal(updateMark("0.1.8"), "0.1.8");
  assert.equal(updateMark(" 0.1.8 "), "0.1.8");
  assert.equal(updateMark(""), undefined);
  assert.equal(updateMark("  "), undefined);
  assert.equal(updateMark(null), undefined);
});

test("maximize label follows window state", () => {
  assert.equal(maximizeLabel(false), "Развернуть окно");
  assert.equal(maximizeLabel(true), "Восстановить окно");
});
