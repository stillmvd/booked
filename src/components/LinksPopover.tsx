import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { placePopover } from "../lib/menuPosition";
import { linkHint } from "../lib/platforms";
import type { Bookmark, BookmarkLink } from "../lib/types";
import { BookmarkThumb } from "./BookmarkThumb";
import { SplitName } from "./Highlighted";
import { Icon, PlatformIcon } from "./Icon";

interface LinksPopoverProps {
  bookmark: Bookmark;
  anchorId: string | null;
  onClose: (restoreFocus: boolean) => void;
  onOpenLink: (link: BookmarkLink) => void;
  onOpenAll: () => void;
}

export function LinksPopover({ bookmark, anchorId, onClose, onOpenLink, onOpenAll }: LinksPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    function place() {
      const el = ref.current;
      if (!el) return;
      const anchorEl = anchorId ? document.getElementById(anchorId) : null;
      const rect = anchorEl?.getBoundingClientRect() ?? null;
      setPos(
        placePopover({
          anchor: rect && rect.width > 0 ? rect : null,
          size: { width: el.offsetWidth, height: el.offsetHeight },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorId, bookmark.links.length]);

  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    const frame = requestAnimationFrame(() => setOpen(true));
    ref.current?.querySelector<HTMLElement>(".links-pop-link")?.focus();
    return () => cancelAnimationFrame(frame);
  }, [placed]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current(true);
    }
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current(false);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  function handleListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const back = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey);
    const forward = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey);
    if (!back && !forward && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(".links-pop-link, .links-pop-all") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (e.key === "End") next = items.length - 1;
    else if (forward) next = index < 0 ? 0 : (index + 1) % items.length;
    else if (back) next = index <= 0 ? items.length - 1 : index - 1;
    items[next].focus();
  }

  return (
    <div
      ref={ref}
      className={"links-pop" + (open && pos ? " open" : "")}
      role="dialog"
      aria-modal="false"
      aria-label={`Ссылки: ${bookmark.title}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={handleListKeyDown}
    >
      <div className="links-pop-head">
        <BookmarkThumb bookmark={bookmark} className="links-pop-photo" />
        <div className="links-pop-who">
          <SplitName text={bookmark.title} className="links-pop-name" />
          {bookmark.description && <span className="links-pop-desc">{bookmark.description}</span>}
        </div>
      </div>
      <div className="links-pop-list">
        {bookmark.links.map((link) => {
          const dead = link.linkStatus === "dead";
          const hint = linkHint(link.url, link.platform, link.label !== null);
          return (
            <button
              key={link.id}
              type="button"
              className={"links-pop-link" + (dead ? " dead" : "")}
              title={link.url}
              onClick={() => onOpenLink(link)}
            >
              <span className="links-pop-icon">
                <PlatformIcon platform={link.platform} />
              </span>
              <span className="links-pop-label">{link.displayLabel}</span>
              {dead ? (
                <span className="links-pop-dead">Страницы нет</span>
              ) : (
                <span className="links-pop-hint">{hint}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="links-pop-foot">
        <span className="links-pop-esc">Esc — закрыть</span>
        <button type="button" className="links-pop-all" onClick={onOpenAll}>
          <Icon name="arrow-up-right" />
          Открыть все
        </button>
      </div>
    </div>
  );
}
