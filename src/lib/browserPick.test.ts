import test from "node:test";
import assert from "node:assert/strict";

import {
  NONE_TARGET,
  browserCaption,
  browserKeyOf,
  profileTargets,
  radioStep,
  selectedEntryIndex,
  selectedProfileIndex,
  targetsMatch,
} from "./browserPick.ts";
import type { BrowserEntry } from "./types.ts";

const firefox: BrowserEntry = {
  key: "mozilla-firefox",
  name: "Mozilla Firefox",
  iconKey: "firefox",
  family: "firefox",
  profiles: [
    { key: "xani2d3d.default-release", name: "Dark", avatarFile: null },
    { key: "C09sTfVb.Профиль 1", name: "Профиль 1", avatarFile: null },
  ],
};
const chrome: BrowserEntry = {
  key: "google-chrome",
  name: "Google Chrome",
  iconKey: "chrome",
  family: "chromium",
  profiles: [{ key: "Default", name: "stillmvd", avatarFile: "a.png" }],
};
const edge: BrowserEntry = { key: "microsoft-edge", name: "Microsoft Edge", iconKey: "edge", family: "chromium", profiles: [] };
const entries = [firefox, chrome, edge];

test("browser key ignores case and punctuation, keeps cyrillic", () => {
  assert.equal(browserKeyOf("Mozilla Firefox"), "mozilla-firefox");
  assert.equal(browserKeyOf("  Яндекс.Браузер "), "яндекс-браузер");
});

test("targets match by browser key and profile", () => {
  const dark = { browser: "mozilla firefox", profile: "xani2d3d.default-release", profileName: "Dark" };
  assert.equal(targetsMatch(dark, { browser: "Mozilla Firefox", profile: "xani2d3d.default-release", profileName: null }), true);
  assert.equal(targetsMatch(dark, { browser: "Mozilla Firefox", profile: null, profileName: null }), false);
  assert.equal(targetsMatch(NONE_TARGET, NONE_TARGET), false);
});

test("selected browser is found by name, missing and empty give -1", () => {
  assert.equal(selectedEntryIndex(entries, { browser: "Google Chrome", profile: "Default", profileName: "stillmvd" }), 1);
  assert.equal(selectedEntryIndex(entries, NONE_TARGET), -1);
  assert.equal(selectedEntryIndex(entries, { browser: "Opera", profile: null, profileName: null }), -1);
});

test("profile choices start with any profile", () => {
  const targets = profileTargets(firefox);
  assert.equal(targets.length, 3);
  assert.deepEqual(targets[0], { browser: "Mozilla Firefox", profile: null, profileName: null });
  assert.deepEqual(targets[2], { browser: "Mozilla Firefox", profile: "C09sTfVb.Профиль 1", profileName: "Профиль 1" });
  assert.equal(selectedProfileIndex(firefox, targets[2]), 2);
  assert.equal(selectedProfileIndex(firefox, { browser: "Mozilla Firefox", profile: "gone", profileName: "Старый" }), -1);
});

test("radio step clamps and ignores other keys", () => {
  assert.equal(radioStep("ArrowRight", 0, 3), 1);
  assert.equal(radioStep("ArrowDown", 2, 3), 2);
  assert.equal(radioStep("ArrowLeft", 0, 3), 0);
  assert.equal(radioStep("ArrowUp", 2, 3), 1);
  assert.equal(radioStep("Home", 2, 3), 0);
  assert.equal(radioStep("End", 0, 3), 2);
  assert.equal(radioStep("Enter", 0, 3), null);
  assert.equal(radioStep("ArrowRight", 0, 0), null);
});

test("caption names the browser and counts profiles", () => {
  assert.deepEqual(browserCaption(entries, NONE_TARGET), { name: "Без назначения", sub: "Как обычно" });
  assert.deepEqual(browserCaption(entries, { browser: "Mozilla Firefox", profile: null, profileName: null }), {
    name: "Mozilla Firefox",
    sub: "2 профиля",
  });
  assert.deepEqual(browserCaption(entries, { browser: "Google Chrome", profile: null, profileName: null }).sub, "1 профиль");
  assert.deepEqual(browserCaption(entries, { browser: "Microsoft Edge", profile: null, profileName: null }).sub, "Без профилей");
  assert.deepEqual(browserCaption(entries, { browser: "Opera", profile: "p", profileName: "Работа" }), {
    name: "Opera · Работа",
    sub: "Не найден на этом компьютере",
  });
});
