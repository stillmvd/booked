export interface SectionTop {
  id: string;
  top: number;
}

export interface ScrollBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export const SPY_OFFSET = 24;

export function activeSection(sections: SectionTop[], box: ScrollBox, offset = SPY_OFFSET): string | null {
  if (sections.length === 0) return null;
  const scrollable = box.scrollHeight > box.clientHeight + 1;
  if (scrollable && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) {
    return sections[sections.length - 1].id;
  }
  let current = sections[0].id;
  for (const section of sections) {
    if (section.top > box.scrollTop + offset) break;
    current = section.id;
  }
  return current;
}
