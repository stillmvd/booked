import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activeSection } from "./scrollSpy.ts";

const sections = [
  { id: "view", top: 0 },
  { id: "window", top: 300 },
  { id: "add", top: 520 },
  { id: "updates", top: 900 },
];

describe("activeSection", () => {
  it("вверху полотна подсвечен первый раздел", () => {
    assert.equal(activeSection(sections, { scrollTop: 0, clientHeight: 480, scrollHeight: 1100 }), "view");
  });

  it("раздел становится текущим, когда его заголовок доезжает до верха с запасом", () => {
    assert.equal(activeSection(sections, { scrollTop: 275, clientHeight: 480, scrollHeight: 1100 }), "view");
    assert.equal(activeSection(sections, { scrollTop: 276, clientHeight: 480, scrollHeight: 1100 }), "window");
    assert.equal(activeSection(sections, { scrollTop: 560, clientHeight: 480, scrollHeight: 1100 }), "add");
  });

  it("докрученное до конца полотно подсвечивает последний раздел, даже если он короткий", () => {
    assert.equal(activeSection(sections, { scrollTop: 620, clientHeight: 480, scrollHeight: 1100 }), "updates");
  });

  it("полотно без прокрутки не прыгает на последний раздел", () => {
    assert.equal(activeSection(sections, { scrollTop: 0, clientHeight: 1200, scrollHeight: 1100 }), "view");
  });

  it("пустой список разделов", () => {
    assert.equal(activeSection([], { scrollTop: 0, clientHeight: 480, scrollHeight: 480 }), null);
  });
});
