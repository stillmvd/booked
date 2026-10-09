import test from "node:test";
import assert from "node:assert/strict";

import { maximizeLabel } from "./titlebar.ts";

test("maximize label follows window state", () => {
  assert.equal(maximizeLabel(false), "Развернуть окно");
  assert.equal(maximizeLabel(true), "Восстановить окно");
});
