const DURATION = 320;
const EXIT_DURATION = 200;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";
const EPSILON = 1;

interface Snapshot {
  rect: DOMRect;
  ghost: HTMLElement | null;
}

function visible(rect: DOMRect, view: DOMRect): boolean {
  return rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right;
}

function fromRect(from: DOMRect, to: { width: number; height: number; left: number; top: number }): string {
  const scale = from.width / to.width;
  const tx = from.left - to.left - (to.width / 2) * (1 - scale);
  const ty = from.top - to.top - (to.height / 2) * (1 - scale);
  return `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function makeGhost(el: HTMLElement): HTMLElement {
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-morph");
  ghost.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  ghost.classList.add("morph-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  return ghost;
}

function mountGhost(ghost: HTMLElement, rect: DOMRect, scope: HTMLElement, view: DOMRect) {
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${rect.left - view.left - scope.clientLeft + scope.scrollLeft}px`,
    top: `${rect.top - view.top - scope.clientTop + scope.scrollTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "1",
    pointerEvents: "none",
  });
  scope.append(ghost);
}

function drop(ghost: HTMLElement, animation: Animation) {
  animation.finished.catch(() => undefined).finally(() => ghost.remove());
}

export function morphLayout(scope: HTMLElement, ghostKeys: string[], update: () => void) {
  const view = scope.getBoundingClientRect();
  const items = Array.from(scope.querySelectorAll<HTMLElement>("[data-morph]"));
  const before = new Map<string, Snapshot>();
  for (const el of items) {
    const key = el.dataset.morph ?? "";
    const rect = el.getBoundingClientRect();
    const ghost = ghostKeys.includes(key) && visible(rect, view) ? makeGhost(el) : null;
    before.set(key, { rect, ghost });
  }
  for (const el of items) el.getAnimations().forEach((animation) => animation.cancel());
  scope.querySelectorAll(".morph-ghost").forEach((ghost) => ghost.remove());

  update();

  const now = scope.getBoundingClientRect();
  const seen = new Set<string>();
  for (const el of scope.querySelectorAll<HTMLElement>("[data-morph]")) {
    const key = el.dataset.morph ?? "";
    seen.add(key);
    const rect = el.getBoundingClientRect();
    const old = before.get(key);

    if (!old) {
      if (visible(rect, now)) {
        el.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], {
          duration: DURATION,
          easing: EASING,
        });
      }
      continue;
    }

    const dx = old.rect.left - rect.left;
    const dy = old.rect.top - rect.top;
    const resized = Math.abs(old.rect.width - rect.width) > EPSILON || Math.abs(old.rect.height - rect.height) > EPSILON;

    if (!resized) {
      if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) continue;
      if (!visible(old.rect, view) && !visible(rect, now)) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: DURATION,
        easing: EASING,
      });
      continue;
    }

    el.animate([{ transform: fromRect(old.rect, rect) }, { transform: "none" }], { duration: DURATION, easing: EASING });
    if (!old.ghost) continue;
    mountGhost(old.ghost, old.rect, scope, view);
    const ghostBox = { left: old.rect.left, top: old.rect.top, width: old.rect.width, height: old.rect.height };
    const animation = old.ghost.animate(
      [
        { transform: "none", opacity: 1 },
        { opacity: 0, offset: 0.45 },
        { transform: fromRect(rect, ghostBox), opacity: 0 },
      ],
      { duration: DURATION, easing: EASING, fill: "forwards" },
    );
    drop(old.ghost, animation);
  }

  before.forEach((old, key) => {
    if (seen.has(key) || !old.ghost) return;
    mountGhost(old.ghost, old.rect, scope, view);
    const animation = old.ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], {
      duration: EXIT_DURATION,
      easing: EASING,
      fill: "forwards",
    });
    drop(old.ghost, animation);
  });
}
