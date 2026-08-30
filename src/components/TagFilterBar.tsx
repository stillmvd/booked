import { useLayoutEffect, useRef, useState } from "react";

import { visibleChipCount } from "../lib/chipRowCap";
import type { TagCount } from "../lib/types";

const CHIP_GAP = 6;

interface TagFilterBarProps {
  tagCounts: TagCount[];
  selectedTags: string[];
  onToggleTag: (name: string) => void;
  onClearTags: () => void;
}

export function TagFilterBar({ tagCounts, selectedTags, onToggleTag, onClearTags }: TagFilterBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedGroupRef = useRef<HTMLDivElement>(null);
  const measureRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moreMeasureRef = useRef<HTMLButtonElement>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedGroupWidth, setSelectedGroupWidth] = useState(0);
  const [chipWidths, setChipWidths] = useState<number[]>([]);
  const [moreWidth, setMoreWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const selected = tagCounts.filter((t) => selectedTags.includes(t.name));
  const available = tagCounts.filter((t) => !selectedTags.includes(t.name));
  const signature = tagCounts.map((t) => `${t.name}:${selectedTags.includes(t.name)}`).join("|");

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setSelectedGroupWidth(selectedGroupRef.current?.getBoundingClientRect().width ?? 0);
    setChipWidths(measureRefs.current.slice(0, available.length).map((el) => el?.offsetWidth ?? 0));
    setMoreWidth(moreMeasureRef.current?.offsetWidth ?? 0);
  }, [signature]);

  if (tagCounts.length === 0) return null;

  const remainingWidth =
    selected.length > 0 ? containerWidth - selectedGroupWidth - CHIP_GAP : containerWidth;
  const cap = visibleChipCount(remainingWidth, chipWidths, CHIP_GAP, moreWidth);
  const needsToggle = available.length > cap;
  const visibleCount = expanded ? available.length : cap;
  const shownAvailable = available.slice(0, visibleCount);
  const hiddenCount = available.length - cap;

  return (
    <div className="tag-filter-bar" ref={containerRef}>
      {selected.length > 0 && (
        <div className="filter-chip-selected-group" ref={selectedGroupRef}>
          {selected.map((tag) => (
            <button
              key={tag.name}
              type="button"
              className="filter-chip"
              aria-pressed={true}
              onClick={() => onToggleTag(tag.name)}
            >
              {tag.name}
            </button>
          ))}
          <button
            type="button"
            className="filter-chip-clear"
            aria-label="Очистить фильтр по тегам"
            onClick={onClearTags}
          >
            ✕
          </button>
          <span className="filter-chip-sep" aria-hidden="true" />
        </div>
      )}
      {shownAvailable.map((tag) => (
        <button
          key={tag.name}
          type="button"
          className="filter-chip"
          aria-pressed={false}
          onClick={() => onToggleTag(tag.name)}
        >
          {tag.name}
        </button>
      ))}
      {needsToggle && (
        <button
          type="button"
          className="filter-chip filter-chip-more"
          aria-label={expanded ? "Свернуть список тегов" : "Показать все теги"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Свернуть" : `+${hiddenCount}`}
        </button>
      )}
      <div className="filter-chip-measure" aria-hidden="true">
        {available.map((tag, i) => (
          <button
            key={tag.name}
            type="button"
            tabIndex={-1}
            className="filter-chip"
            ref={(el) => {
              measureRefs.current[i] = el;
            }}
          >
            {tag.name}
          </button>
        ))}
        <button type="button" tabIndex={-1} className="filter-chip filter-chip-more" ref={moreMeasureRef}>
          {`+${available.length}`}
        </button>
      </div>
    </div>
  );
}
