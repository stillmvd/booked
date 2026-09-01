import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

import type { MenuAction, MenuGroup } from "../lib/menuItems";
import type { Rect } from "../lib/menuPosition";
import { placeMenu } from "../lib/menuPosition";

export type { MenuAction, MenuGroup };

const SUBMENU_HOVER_DELAY_MS = 150;

interface OpenSubmenu {
  actionId: string;
  anchor: Rect;
  groups: MenuGroup[];
}

export interface ContextMenuProps {
  groups: MenuGroup[];
  anchor: Rect;
  ariaLabel: string;
  onClose: () => void;
}

function flatten(groups: MenuGroup[]): MenuAction[] {
  return groups.flat();
}

function findAction(groups: MenuGroup[], id: string | null): MenuAction | null {
  if (id === null) return null;
  return flatten(groups).find((a) => a.id === id) ?? null;
}

interface MenuSurfaceProps {
  groups: MenuGroup[];
  anchor: Rect;
  prefer: "point" | "side";
  ariaLabel: string;
  sub?: boolean;
  activeId: string | null;
  registerRef: (id: string, el: HTMLButtonElement | null) => void;
  openSubmenuId: string | null;
  onItemClick: (action: ReactMouseEvent, item: MenuAction) => void;
  onItemMouseEnter: (item: MenuAction, el: HTMLButtonElement) => void;
  onItemMouseLeave: (item: MenuAction) => void;
}

function MenuSurface({
  groups,
  anchor,
  prefer,
  ariaLabel,
  sub,
  activeId,
  registerRef,
  openSubmenuId,
  onItemClick,
  onItemMouseEnter,
  onItemMouseLeave,
}: MenuSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPos(placeMenu({ anchor, size, viewport, prefer }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      className={"ctx-menu" + (sub ? " ctx-menu-sub" : "") + (pos ? " open" : "")}
      style={pos ? { left: pos.left, top: pos.top } : { left: anchor.left, top: anchor.top, visibility: "hidden" }}
    >
      {groups.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <div className="ctx-menu-sep" />}
          {group.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.id}
              ref={(el) => registerRef(item.id, el)}
              tabIndex={activeId === item.id ? 0 : -1}
              className={
                "ctx-menu-item" +
                (item.danger ? " danger" : "") +
                (item.indent ? " ctx-menu-item-indent" : "")
              }
              aria-haspopup={item.submenu ? "true" : undefined}
              aria-expanded={item.submenu ? openSubmenuId === item.id : undefined}
              onMouseEnter={(e) => onItemMouseEnter(item, e.currentTarget)}
              onMouseLeave={() => onItemMouseLeave(item)}
              onClick={(e) => onItemClick(e, item)}
            >
              {item.icon}
              <span className="ctx-menu-item-label">{item.label}</span>
              {item.submenu ? (
                <span className="ctx-menu-chevron" aria-hidden="true">
                  ▸
                </span>
              ) : item.shortcut ? (
                <span className="ctx-menu-shortcut">{item.shortcut}</span>
              ) : null}
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function ContextMenu({ groups, anchor, ariaLabel, onClose }: ContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const subItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [subActiveId, setSubActiveId] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<OpenSubmenu | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openSubmenuRef = useRef(openSubmenu);
  openSubmenuRef.current = openSubmenu;

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, []);

  function registerRootRef(id: string, el: HTMLButtonElement | null) {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }

  function registerSubRef(id: string, el: HTMLButtonElement | null) {
    if (el) subItemRefs.current.set(id, el);
    else subItemRefs.current.delete(id);
  }

  function closeSubmenu(refocusParent: boolean) {
    const sub = openSubmenuRef.current;
    setOpenSubmenu(null);
    setSubActiveId(null);
    if (refocusParent && sub) {
      setActiveId(sub.actionId);
      itemRefs.current.get(sub.actionId)?.focus();
    }
  }

  function openSubmenuFor(item: MenuAction, el: HTMLButtonElement, focusFirst: boolean) {
    if (!item.submenu) return;
    hoverTimerRef.current && clearTimeout(hoverTimerRef.current);
    subItemRefs.current.clear();
    setOpenSubmenu({ actionId: item.id, anchor: el.getBoundingClientRect(), groups: item.submenu });
    if (focusFirst) {
      const first = flatten(item.submenu)[0];
      setSubActiveId(first ? first.id : null);
      requestAnimationFrame(() => {
        if (first) subItemRefs.current.get(first.id)?.focus();
      });
    } else {
      setSubActiveId(null);
    }
  }

  function runAction(item: MenuAction) {
    if (item.submenu) return;
    item.onSelect();
    onCloseRef.current();
  }

  function handleItemClick(e: ReactMouseEvent, item: MenuAction) {
    if (item.submenu) {
      openSubmenuFor(item, e.currentTarget as HTMLButtonElement, false);
      return;
    }
    runAction(item);
  }

  function handleItemMouseEnter(item: MenuAction, el: HTMLButtonElement) {
    if (item.submenu) {
      hoverTimerRef.current && clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => openSubmenuFor(item, el, false), SUBMENU_HOVER_DELAY_MS);
      return;
    }
    if (openSubmenuRef.current) closeSubmenu(false);
  }

  function handleItemMouseLeave(item: MenuAction) {
    if (item.submenu && hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  function moveActive(dir: number, ids: string[], current: string | null, apply: (id: string) => void) {
    if (ids.length === 0) return;
    let idx = current ? ids.indexOf(current) : -1;
    if (idx === -1) {
      idx = dir > 0 ? 0 : ids.length - 1;
    } else {
      const next = idx + dir;
      if (next < 0 || next >= ids.length) return;
      idx = next;
    }
    apply(ids[idx]);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (openSubmenu) {
      const ids = flatten(openSubmenu.groups).map((a) => a.id);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveActive(1, ids, subActiveId, (id) => {
          setSubActiveId(id);
          subItemRefs.current.get(id)?.focus();
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveActive(-1, ids, subActiveId, (id) => {
          setSubActiveId(id);
          subItemRefs.current.get(id)?.focus();
        });
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        if (ids[0]) {
          setSubActiveId(ids[0]);
          subItemRefs.current.get(ids[0])?.focus();
        }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const last = ids[ids.length - 1];
        if (last) {
          setSubActiveId(last);
          subItemRefs.current.get(last)?.focus();
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        closeSubmenu(true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSubmenu(true);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const action = findAction(openSubmenu.groups, subActiveId);
        if (action) runAction(action);
        return;
      }
      return;
    }

    const ids = flatten(groups).map((a) => a.id);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1, ids, activeId, (id) => {
        setActiveId(id);
        itemRefs.current.get(id)?.focus();
      });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1, ids, activeId, (id) => {
        setActiveId(id);
        itemRefs.current.get(id)?.focus();
      });
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      if (ids[0]) {
        setActiveId(ids[0]);
        itemRefs.current.get(ids[0])?.focus();
      }
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = ids[ids.length - 1];
      if (last) {
        setActiveId(last);
        itemRefs.current.get(last)?.focus();
      }
      return;
    }
    if (e.key === "ArrowRight") {
      const action = findAction(groups, activeId);
      if (action?.submenu) {
        e.preventDefault();
        const el = itemRefs.current.get(action.id);
        if (el) openSubmenuFor(action, el, true);
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const action = findAction(groups, activeId);
      if (action) {
        if (action.submenu) {
          const el = itemRefs.current.get(action.id);
          if (el) openSubmenuFor(action, el, true);
        } else {
          runAction(action);
        }
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCloseRef.current();
    }
  }

  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={handleKeyDown} style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto" }}>
        <MenuSurface
          groups={groups}
          anchor={anchor}
          prefer="point"
          ariaLabel={ariaLabel}
          activeId={activeId}
          registerRef={registerRootRef}
          openSubmenuId={openSubmenu?.actionId ?? null}
          onItemClick={handleItemClick}
          onItemMouseEnter={handleItemMouseEnter}
          onItemMouseLeave={handleItemMouseLeave}
        />
        {openSubmenu && (
          <MenuSurface
            groups={openSubmenu.groups}
            anchor={openSubmenu.anchor}
            prefer="side"
            ariaLabel="Открыть в…"
            sub
            activeId={subActiveId}
            registerRef={registerSubRef}
            openSubmenuId={null}
            onItemClick={(_e, item) => runAction(item)}
            onItemMouseEnter={() => {}}
            onItemMouseLeave={() => {}}
          />
        )}
      </div>
    </div>
  );
}
