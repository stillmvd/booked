import { test } from "node:test";
import assert from "node:assert/strict";

import { hostOf, plate, plateIndex, tint } from "./plate.ts";

const HEX = /^#[0-9a-f]{6}$/;

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
}

test("индекс плашки любого сида лежит в 0..7", () => {
  for (let i = 0; i < 200; i++) {
    const idx = plateIndex(`example-host-${i}.test`);
    assert.ok(idx >= 0 && idx <= 7, `index ${idx} out of range`);
  }
});

test("один и тот же сид даёт одну и ту же плашку", () => {
  const seed = "docs.rs";
  assert.deepEqual(plate(seed, "dark"), plate(seed, "dark"));
  assert.deepEqual(plate(seed, "light"), plate(seed, "light"));
});

test("разные сиды распределяются по нескольким плашкам", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 64; i++) seen.add(plateIndex(`host-${i}.example`));
  assert.ok(seen.size >= 4, `only ${seen.size} plates used`);
});

test("hostOf снимает www и схему", () => {
  assert.equal(hostOf("https://www.example.com/a"), "example.com");
  assert.equal(hostOf("https://docs.rs/serde"), "docs.rs");
});

test("тёмная плашка: тёмный фон и светлая буква; светлая — наоборот", () => {
  for (const seed of ["docs.rs", "", "заметки.рф", "example.com"]) {
    const dark = plate(seed, "dark");
    const light = plate(seed, "light");
    assert.match(dark.bg, HEX);
    assert.match(dark.fg, HEX);
    assert.match(light.bg, HEX);
    assert.match(light.fg, HEX);
    assert.ok(luma(dark.bg) < luma(dark.fg), `dark ${seed}`);
    assert.ok(luma(light.bg) > luma(light.fg), `light ${seed}`);
  }
});

function saturation(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.max(...c) - Math.min(...c);
}

test("плашка превью нейтральная в обеих темах, tint тега — цветной и с тем же индексом", () => {
  for (const seed of ["rust", "почитать", "example.com", ""]) {
    for (const theme of ["dark", "light"] as const) {
      assert.ok(saturation(plate(seed, theme).bg) < 12, `plate bg ${theme} ${seed}`);
      assert.ok(saturation(tint(seed, theme).fg) >= 30, `tint fg ${theme} ${seed}`);
    }
    assert.deepEqual(tint(seed, "dark"), tint(seed, "dark"));
  }
  const seen = new Set<string>();
  for (let i = 0; i < 64; i++) seen.add(tint(`тег-${i}`, "dark").fg);
  assert.ok(seen.size >= 4, `only ${seen.size} tints used`);
});

test("индекс одинаков в обеих темах для кириллицы и пустой строки", () => {
  for (const seed of ["заметки.рф", "", "Кириллица.example"]) {
    const idx = plateIndex(seed);
    assert.ok(idx >= 0 && idx <= 7);
    assert.notEqual(plate(seed, "dark").bg, plate(seed, "light").bg);
  }
});
