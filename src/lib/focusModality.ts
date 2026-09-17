const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "NumLock", "ScrollLock", "Fn"]);

export const KEYS_ATTR = "data-keys";
export const KEYBOARD_FOCUS = ":focus-visible:where(:root[data-keys] *)";

export function isNavigationKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return !MODIFIERS.has(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey;
}

export function watchFocusModality(doc: Document): void {
  const root = doc.documentElement;
  doc.addEventListener(
    "keydown",
    (e) => {
      if (isNavigationKey(e)) root.setAttribute(KEYS_ATTR, "");
    },
    true,
  );
  doc.addEventListener("pointerdown", () => root.removeAttribute(KEYS_ATTR), true);
}
