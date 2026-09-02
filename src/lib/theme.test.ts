import { test } from "node:test";
import assert from "node:assert/strict";

import { applyTheme, resolveTheme, onSystemThemeChange, systemPrefersDark } from "./theme.ts";

test("явный выбор сильнее системы", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("системная тема следует за признаком systemDark", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("onSystemThemeChange возвращает отписку, после которой обработчик не зовётся", () => {
  const original = globalThis.matchMedia;
  let handler: ((e: MediaQueryListEvent) => void) | null = null;
  // @ts-expect-error test stub, not a full MediaQueryList
  globalThis.matchMedia = (_query: string) => ({
    matches: false,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      handler = cb;
    },
    removeEventListener: (_type: string, _cb: (e: MediaQueryListEvent) => void) => {
      handler = null;
    },
  });

  const calls: boolean[] = [];
  const unsubscribe = onSystemThemeChange((dark) => calls.push(dark));
  assert.ok(handler);
  handler!({ matches: true } as MediaQueryListEvent);
  assert.deepEqual(calls, [true]);

  unsubscribe();
  assert.equal(handler, null);

  globalThis.matchMedia = original;
});

test("applyTheme без document в окружении не роняет модуль", () => {
  assert.doesNotThrow(() => applyTheme("light"));
});

test("отсутствие matchMedia не роняет модуль", () => {
  const original = globalThis.matchMedia;
  // @ts-expect-error удаляем matchMedia из окружения намеренно
  delete globalThis.matchMedia;

  assert.equal(systemPrefersDark(), false);
  const unsubscribe = onSystemThemeChange(() => {});
  assert.doesNotThrow(() => unsubscribe());
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");

  globalThis.matchMedia = original;
});
