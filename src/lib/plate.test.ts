import { test } from "node:test";
import assert from "node:assert/strict";

import { hostOf, plate } from "./plate.ts";

test("оттенок любого сида лежит в диапазоне 186..301 включительно", () => {
  for (let i = 0; i < 200; i++) {
    const seed = `example-host-${i}.test`;
    const { hue } = plate(seed);
    assert.ok(hue >= 186 && hue <= 301, `hue ${hue} out of range for seed ${seed}`);
  }
});

test("один и тот же сид даёт один и тот же оттенок", () => {
  const seed = "docs.rs";
  assert.deepEqual(plate(seed), plate(seed));
});

test("hostOf снимает www и схему", () => {
  assert.equal(hostOf("https://www.example.com/a"), "example.com");
  assert.equal(hostOf("https://docs.rs/serde"), "docs.rs");
});
