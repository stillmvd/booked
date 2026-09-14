import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  TRACKING_PARAMS,
  addLink,
  autoLabel,
  canRemove,
  fromBookmarkLinks,
  linksChanged,
  moveLink,
  normalizeLinkInput,
  normalizedUrl,
  removeLink,
  sameUrl,
  setLabel,
  toLinkInputs,
} from "./linksEdit.ts";
import type { EditableLink } from "./linksEdit.ts";

function list(...urls: string[]): EditableLink[] {
  return urls.map((url, i) => ({ key: `k${i}`, url, label: null, linkStatus: null }));
}

test("адрес без схемы получает https, мусор отклоняется", () => {
  assert.equal(normalizeLinkInput(" instagram.com/anya "), "https://instagram.com/anya");
  assert.equal(normalizeLinkInput("http://t.me/anya"), "http://t.me/anya");
  assert.equal(normalizeLinkInput("javascript://alert(1)"), null);
  assert.equal(normalizeLinkInput("просто текст"), null);
  assert.equal(normalizeLinkInput("anya"), null);
  assert.equal(normalizeLinkInput(""), null);
});

test("добавление: в конец, без повтора, с понятной причиной отказа", () => {
  const start = list("https://instagram.com/anya");
  const added = addLink(start, "t.me/anya");
  assert.ok(added.ok);
  if (!added.ok) return;
  assert.deepEqual(added.links.map((l) => l.url), ["https://instagram.com/anya", "https://t.me/anya"]);
  assert.equal(added.added.label, null);
  const again = addLink(added.links, "https://www.instagram.com/anya/");
  assert.deepEqual(again, { ok: false, reason: "Эта ссылка уже есть в списке" });
  const bad = addLink(start, "не адрес");
  assert.equal(bad.ok, false);
});

test("сравнение адресов повторяет правила ядра", () => {
  assert.equal(normalizedUrl("https://WWW.Example.COM/A/?utm_source=x&b=2#frag"), "https://example.com/A?b=2#frag");
  assert.equal(normalizedUrl("https://example.com:443/x"), "https://example.com/x");
  assert.equal(normalizedUrl("http://example.com:80/"), "http://example.com");
  assert.equal(normalizedUrl("https://example.com/?fbclid=1&gclid=2&ref=3&yclid=4&utm_campaign=5&q=kept"), "https://example.com/?q=kept");
  assert.equal(normalizedUrl("https://example.com/?b=2&a=1"), "https://example.com/?b=2&a=1");
  assert.equal(sameUrl("https://tiktok.com/@anya?utm_source=ig", "https://www.tiktok.com/@anya/"), true);
  assert.equal(sameUrl("https://github.com/Anya", "https://github.com/anya"), false);
  assert.equal(sameUrl("http://t.me/anya", "https://t.me/anya"), false);
});

test("трекинг-параметры совпадают с ядром", () => {
  const rust = fs.readFileSync("src-tauri/core/src/url_norm.rs", "utf8");
  const start = rust.indexOf("TRACKING_PARAMS");
  const block = rust.slice(start, rust.indexOf("];", start));
  const core = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(core.length > 0);
  assert.deepEqual(TRACKING_PARAMS, core);
  assert.match(rust, /starts_with\("utm_"\)/);
});

test("добавление сравнивает адреса как ядро: utm не различает, регистр пути различает", () => {
  const start = list("https://www.tiktok.com/@anya?utm_source=ig");
  assert.deepEqual(addLink(start, "tiktok.com/@anya"), { ok: false, reason: "Эта ссылка уже есть в списке" });
  const cased = addLink(list("https://github.com/Anya"), "github.com/anya");
  assert.equal(cased.ok, true);
});

test("своя подпись и возврат к автоподписи", () => {
  const start = list("https://t.me/anya");
  const custom = setLabel(start, "k0", "Канал");
  assert.equal(custom[0].label, "Канал");
  assert.equal(setLabel(custom, "k0", "")[0].label, null);
  assert.equal(setLabel(custom, "k0", "   ")[0].label, null);
  assert.equal(autoLabel("https://t.me/anya"), "Telegram");
  assert.equal(autoLabel("https://www.anya.example.com/"), "anya.example.com");
});

test("перестановка делает первой главную ссылку", () => {
  const start = list("a.com", "b.com", "c.com");
  assert.deepEqual(moveLink(start, 1, 0).map((l) => l.url), ["b.com", "a.com", "c.com"]);
  assert.deepEqual(moveLink(start, 0, 2).map((l) => l.url), ["b.com", "c.com", "a.com"]);
  assert.deepEqual(moveLink(start, 0, 5).map((l) => l.url), ["a.com", "b.com", "c.com"]);
});

test("последнюю ссылку удалить нельзя", () => {
  const two = list("a.com", "b.com");
  assert.equal(canRemove(two), true);
  const one = removeLink(two, "k0");
  assert.deepEqual(one.map((l) => l.url), ["b.com"]);
  assert.equal(canRemove(one), false);
  assert.deepEqual(removeLink(one, "k1").map((l) => l.url), ["b.com"]);
});

test("изменения списка и выгрузка в команду", () => {
  const links = fromBookmarkLinks([
    { id: 7, url: "https://t.me/a", urlNormalized: "t.me/a", label: "Канал", displayLabel: "Канал", platform: "telegram", linkStatus: "dead", linkReason: null, httpStatus: 404, lastCheckedAt: 1, failCount: 2 },
  ]);
  assert.deepEqual(links, [{ key: "id-7", url: "https://t.me/a", label: "Канал", linkStatus: "dead" }]);
  assert.deepEqual(toLinkInputs(links), [{ url: "https://t.me/a", label: "Канал" }]);
  assert.equal(linksChanged(links, links), false);
  assert.equal(linksChanged(links, setLabel(links, "id-7", "")), true);
});
