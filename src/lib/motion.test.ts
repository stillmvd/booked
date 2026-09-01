import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DUR, DUR_REDUCED, durations, onReducedMotionChange } from "./motion.ts";

const CSS_PATH = "src/styles.css";

function readCss(): string {
  return fs.readFileSync(CSS_PATH, "utf8");
}

function parseDurBlock(block: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of block.matchAll(/--dur-([a-z-]+):\s*(\d+)ms/g)) {
    out[toCamel(m[1])] = Number(m[2]);
  }
  return out;
}

function toCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

const DUR_FIELDS = ["hover", "enter", "exit", "flip", "nav", "sheetIn", "sheetOut", "dragReturn"] as const;

test("DUR_has_exactly_eight_numeric_fields_none_above_250", () => {
  const keys = Object.keys(DUR);
  assert.equal(keys.length, 8);
  for (const key of DUR_FIELDS) {
    assert.equal(typeof DUR[key], "number");
    assert.ok(DUR[key] <= 250, `${key} above ceiling: ${DUR[key]}`);
  }
});

test("enter_exit_ratio_is_between_0_6_and_0_8", () => {
  const ratio = DUR.exit / DUR.enter;
  assert.ok(ratio >= 0.6 && ratio <= 0.8, `ratio ${ratio}`);
});

test("sheet_in_out_ratio_is_between_0_6_and_0_8", () => {
  const ratio = DUR.sheetOut / DUR.sheetIn;
  assert.ok(ratio >= 0.6 && ratio <= 0.8, `ratio ${ratio}`);
});

test("reduced_enter_exit_ratio_is_between_0_6_and_0_8", () => {
  const ratio = DUR_REDUCED.exit / DUR_REDUCED.enter;
  assert.ok(ratio >= 0.6 && ratio <= 0.8, `ratio ${ratio}`);
});

test("reduced_sheet_in_out_ratio_is_between_0_6_and_0_8", () => {
  const ratio = DUR_REDUCED.sheetOut / DUR_REDUCED.sheetIn;
  assert.ok(ratio >= 0.6 && ratio <= 0.8, `ratio ${ratio}`);
});

test("dur_numbers_match_root_css_declarations", () => {
  const css = readCss();
  const rootBlock = css.slice(0, css.indexOf("prefers-reduced-motion"));
  const cssDur = parseDurBlock(rootBlock);
  for (const key of DUR_FIELDS) {
    assert.equal(DUR[key], cssDur[key], `mismatch for ${key}`);
  }
});

test("dur_reduced_numbers_match_reduced_motion_block_css_declarations", () => {
  const css = readCss();
  const reducedStart = css.indexOf("prefers-reduced-motion");
  const reducedBlockEnd = css.indexOf("}", css.indexOf("}", reducedStart) + 1);
  const reducedBlock = css.slice(reducedStart, reducedBlockEnd);
  const cssDurReduced = parseDurBlock(reducedBlock);

  for (const key of ["enter", "exit", "flip", "nav", "sheetIn", "sheetOut"] as const) {
    assert.equal(DUR_REDUCED[key], cssDurReduced[key], `mismatch for ${key}`);
  }
  assert.equal(DUR_REDUCED.hover, DUR.hover);
  assert.equal(DUR_REDUCED.dragReturn, DUR.dragReturn);
});

test("reduced_motion_block_has_no_ease_declarations", () => {
  const css = readCss();
  const reducedStart = css.indexOf("prefers-reduced-motion");
  const reducedBlockEnd = css.indexOf("}", css.indexOf("}", reducedStart) + 1);
  const reducedBlock = css.slice(reducedStart, reducedBlockEnd);
  assert.ok(!/--ease-/.test(reducedBlock));
});

test("durations_true_returns_dur_reduced_false_returns_dur", () => {
  assert.equal(durations(true), DUR_REDUCED);
  assert.equal(durations(false), DUR);
});

function createMatchMediaStub() {
  let listenerCount = 0;
  const stub = (_query: string) => ({
    matches: false,
    addEventListener: (_type: string, _cb: (e: MediaQueryListEvent) => void) => {
      listenerCount += 1;
    },
    removeEventListener: (_type: string, _cb: (e: MediaQueryListEvent) => void) => {
      listenerCount -= 1;
    },
  });
  return { stub, count: () => listenerCount };
}

test("on_reduced_motion_change_subscribes_and_unsubscribe_stops_calls", () => {
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
  const unsubscribe = onReducedMotionChange((reduced) => calls.push(reduced));
  assert.ok(handler);
  handler!({ matches: true } as MediaQueryListEvent);
  assert.deepEqual(calls, [true]);

  unsubscribe();
  assert.equal(handler, null);

  globalThis.matchMedia = original;
});

test("double_subscribe_and_unsubscribe_leaves_no_live_subscriptions", () => {
  const original = globalThis.matchMedia;
  const { stub, count } = createMatchMediaStub();
  // @ts-expect-error test stub, not a full MediaQueryList
  globalThis.matchMedia = stub;

  const unsub1 = onReducedMotionChange(() => {});
  const unsub2 = onReducedMotionChange(() => {});
  assert.equal(count(), 2);

  unsub1();
  unsub2();
  assert.equal(count(), 0);

  globalThis.matchMedia = original;
});
