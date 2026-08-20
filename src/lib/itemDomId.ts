export function itemDomId(kind: "folder" | "bookmark", id: number): string {
  return kind === "folder" ? `f${id}` : `b${id}`;
}
