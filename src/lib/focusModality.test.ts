import { test } from "node:test";
import assert from "node:assert/strict";

import { isNavigationKey } from "./focusModality.ts";

const key = (name: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: name,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

test("одни модификаторы не включают рамки фокуса", () => {
  for (const name of ["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]) {
    assert.equal(isNavigationKey(key(name)), false, name);
  }
});

test("сочетания с Ctrl, Alt и Win — горячие клавиши, а не навигация", () => {
  assert.equal(isNavigationKey(key("c", { ctrlKey: true })), false);
  assert.equal(isNavigationKey(key("Tab", { altKey: true })), false);
  assert.equal(isNavigationKey(key("d", { metaKey: true })), false);
});

test("Tab, Shift+Tab, стрелки, Enter, Esc и F2 включают рамки", () => {
  for (const name of ["Tab", "ArrowDown", "ArrowLeft", "Enter", " ", "Escape", "Home", "F2", "Delete"]) {
    assert.equal(isNavigationKey(key(name)), true, name);
  }
});
