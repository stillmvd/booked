import { test } from "node:test";
import assert from "node:assert/strict";

import { createPreviewQueue } from "./previewQueue.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("id_held_past_debounce_is_flushed", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  await wait(120);

  assert.deepEqual(flushed, [[1]]);
  queue.dispose();
});

test("id_unobserved_before_debounce_is_not_flushed", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 20,
  });

  queue.observe(1);
  queue.unobserve(1);
  await wait(120);

  assert.deepEqual(flushed, []);
  queue.dispose();
});

test("observe_unobserve_observe_flushes_once", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  queue.unobserve(1);
  queue.observe(1);
  await wait(120);

  assert.deepEqual(flushed, [[1]]);
  queue.dispose();
});

test("repeated_observe_of_same_id_does_not_create_duplicate_record", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  queue.observe(1);
  queue.observe(1);
  await wait(120);

  assert.deepEqual(flushed, [[1]]);
  queue.dispose();
});

test("flush_delivers_multiple_ids_in_one_batch", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  queue.observe(2);
  queue.observe(3);
  await wait(120);

  assert.equal(flushed.length, 1);
  assert.deepEqual([...flushed[0]].sort(), [1, 2, 3]);
  queue.dispose();
});

test("batch_is_capped_and_remainder_flushes_next_round", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
    batchSize: 2,
  });

  queue.observe(1);
  queue.observe(2);
  queue.observe(3);
  await wait(180);

  assert.equal(flushed.length, 2);
  assert.equal(flushed[0].length, 2);
  assert.equal(flushed[1].length, 1);
  const all = [...flushed[0], ...flushed[1]].sort();
  assert.deepEqual(all, [1, 2, 3]);
  queue.dispose();
});

test("flushed_id_is_not_reoffered_until_reobserved", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  await wait(120);
  assert.deepEqual(flushed, [[1]]);

  await wait(120);
  assert.deepEqual(flushed, [[1]]);
  queue.dispose();
});

test("dispose_clears_timers_and_suppresses_later_flush", async () => {
  const flushed: number[][] = [];
  const queue = createPreviewQueue({
    onFlush: (ids) => {
      flushed.push(ids);
    },
    debounceMs: 10,
  });

  queue.observe(1);
  queue.dispose();
  await wait(120);

  assert.deepEqual(flushed, []);
});

test("flush_rejection_does_not_break_queue_or_block_next_flush", async () => {
  const flushed: number[][] = [];
  let calls = 0;
  const queue = createPreviewQueue({
    onFlush: async (ids) => {
      calls += 1;
      flushed.push(ids);
      if (calls === 1) throw new Error("network down");
    },
    debounceMs: 10,
  });

  queue.observe(1);
  await wait(120);
  queue.observe(2);
  await wait(120);

  assert.deepEqual(flushed, [[1], [2]]);
  queue.dispose();
});
