import { test } from "node:test";
import assert from "node:assert/strict";

import { hostOf, plate } from "./plate.ts";

test("оттенок любого сида лежит в диапазоне 186..301 включительно", () => {
  for (let i = 0; i < 200; i++) {
    const seed = `example-host-${i}.test`;
    const { hue } = plate(seed, "dark");
    assert.ok(hue >= 186 && hue <= 301, `hue ${hue} out of range for seed ${seed}`);
  }
});

test("один и тот же сид даёт один и тот же оттенок", () => {
  const seed = "docs.rs";
  assert.deepEqual(plate(seed, "dark"), plate(seed, "dark"));
  assert.deepEqual(plate(seed, "light"), plate(seed, "light"));
});

test("hostOf снимает www и схему", () => {
  assert.equal(hostOf("https://www.example.com/a"), "example.com");
  assert.equal(hostOf("https://docs.rs/serde"), "docs.rs");
});

test("plate(seed, dark) совпадает с прежней жёстко тёмной формулой", () => {
  for (const seed of ["docs.rs", "", "заметки.рф", "example.com"]) {
    const { bg, fg, hue } = plate(seed, "dark");
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h * 31 + seed.charCodeAt(i)) % 360;
    }
    const expectedHue = 186 + (h % 116);
    assert.equal(hue, expectedHue);
    assert.equal(bg, `hsl(${expectedHue} 20% 20%)`);
    assert.equal(fg, `hsl(${expectedHue} 28% 62%)`);
  }
});

test("plate(seed, light) даёт светлый фон и тёмный текст", () => {
  const { bg, fg } = plate("docs.rs", "light");
  assert.match(bg, /^hsl\(\d+ 30% 91%\)$/);
  assert.match(fg, /^hsl\(\d+ 42% 36%\)$/);
});

test("оттенок одинаков в обеих темах для одного и того же зерна", () => {
  for (const seed of ["docs.rs", "заметки.рф", ""]) {
    assert.equal(plate(seed, "dark").hue, plate(seed, "light").hue);
  }
});

test("оттенок остаётся в холодном секторе для кириллицы и пустой строки", () => {
  for (const seed of ["заметки.рф", "", "Кириллица.example"]) {
    const { hue } = plate(seed, "light");
    assert.ok(hue >= 186 && hue <= 301, `hue ${hue} out of range for seed ${seed}`);
  }
});
