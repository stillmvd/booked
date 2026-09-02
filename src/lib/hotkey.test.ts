import { test } from "node:test";
import assert from "node:assert/strict";

import { comboFromKeyEvent, isModifierKey } from "./hotkey.ts";

function chord(code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) {
  return {
    code,
    ctrlKey: mods.ctrlKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    metaKey: mods.metaKey ?? false,
  };
}

test("modifier_only_press_returns_null_and_keeps_waiting", () => {
  assert.equal(comboFromKeyEvent(chord("ControlLeft", { ctrlKey: true })), null);
  assert.equal(comboFromKeyEvent(chord("AltRight", { altKey: true })), null);
  assert.equal(comboFromKeyEvent(chord("ShiftLeft", { shiftKey: true })), null);
  assert.equal(comboFromKeyEvent(chord("MetaLeft", { metaKey: true })), null);
});

test("isModifierKey_recognizes_both_left_and_right_variants", () => {
  assert.ok(isModifierKey("ControlLeft"));
  assert.ok(isModifierKey("ControlRight"));
  assert.ok(isModifierKey("AltLeft"));
  assert.ok(isModifierKey("ShiftRight"));
  assert.ok(isModifierKey("MetaLeft"));
  assert.ok(!isModifierKey("KeyB"));
});

test("letter_key_with_two_modifiers_matches_default_hotkey_format", () => {
  const combo = comboFromKeyEvent(chord("KeyB", { ctrlKey: true, altKey: true }));
  assert.equal(combo, "Ctrl+Alt+B");
});

test("digit_key_without_modifiers_produces_bare_digit", () => {
  const combo = comboFromKeyEvent(chord("Digit1"));
  assert.equal(combo, "1");
});

test("long_combination_of_three_modifiers_and_function_key", () => {
  const combo = comboFromKeyEvent(chord("F12", { ctrlKey: true, altKey: true, shiftKey: true }));
  assert.equal(combo, "Ctrl+Alt+Shift+F12");
});

test("non_letter_non_digit_key_keeps_its_dom_code_name", () => {
  const combo = comboFromKeyEvent(chord("ArrowUp", { altKey: true }));
  assert.equal(combo, "Alt+ArrowUp");
});

test("super_modifier_maps_to_windows_key", () => {
  const combo = comboFromKeyEvent(chord("KeyN", { metaKey: true }));
  assert.equal(combo, "Super+N");
});
