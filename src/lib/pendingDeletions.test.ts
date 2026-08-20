import { test } from "node:test";
import assert from "node:assert/strict";

import { schedule, cancel, flushAll, pendingKeys } from "./pendingDeletions.ts";

test("cancel_prevents_run", () => {
  let calls = 0;
  schedule("bookmark:1", () => {
    calls += 1;
  });
  assert.equal(pendingKeys().has("bookmark:1"), true);

  cancel("bookmark:1");

  assert.equal(pendingKeys().has("bookmark:1"), false);
  assert.equal(calls, 0);
});

test("flush_all_runs_pending_immediately", async () => {
  let resolved = false;
  schedule("bookmark:2", async () => {
    resolved = true;
  });

  await flushAll();

  assert.equal(resolved, true);
  assert.equal(pendingKeys().has("bookmark:2"), false);
});
