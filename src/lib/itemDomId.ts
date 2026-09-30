export function itemDomId(kind: "folder" | "bookmark", id: number): string {
  return kind === "folder" ? `f${id}` : `b${id}`;
}

export type ItemTarget = { kind: "card" | "folder"; id: number };

export function resolveItemTarget(el: Element | null): ItemTarget | null {
  const item = el?.closest<HTMLElement>("[data-item]");
  if (!item) return null;
  const id = Number(item.id.slice(1));
  if (!Number.isFinite(id)) return null;
  if (item.id.startsWith("f")) return { kind: "folder", id };
  if (item.id.startsWith("b")) return { kind: "card", id };
  return null;
}
