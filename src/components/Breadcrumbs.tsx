import { useLayoutEffect, useRef, useState } from "react";

import type { Rect } from "../lib/menuPosition";
import type { Crumb } from "../lib/types";
import { ContextMenu } from "./ContextMenu";

interface BreadcrumbsProps {
  crumbs: Crumb[];
  onNavigate: (id: number | null) => void;
}

export function Breadcrumbs({ crumbs, onNavigate }: BreadcrumbsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    setCollapsed(false);
    setMenuAnchor(null);
  }, [crumbs]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || collapsed) return;

    function measure() {
      if (el && el.scrollWidth > el.clientWidth) {
        setCollapsed(true);
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [crumbs, collapsed]);

  const middle = crumbs.slice(0, -1);
  const current = crumbs.length > 0 ? crumbs[crumbs.length - 1] : null;
  const showEllipsis = collapsed && middle.length > 0;

  return (
    <div className="breadcrumbs" ref={rootRef}>
      <button type="button" className="breadcrumb" onClick={() => onNavigate(null)}>
        Magpie
      </button>
      {showEllipsis ? (
        <span className="breadcrumb-group">
          <span className="breadcrumb-sep">/</span>
          <button
            type="button"
            className="breadcrumb breadcrumb-ellipsis"
            title={middle.map((crumb) => crumb.name).join(" / ")}
            aria-label="Показать путь"
            aria-haspopup="menu"
            onClick={(e) => setMenuAnchor(e.currentTarget.getBoundingClientRect())}
          >
            …
          </button>
          {menuAnchor && (
            <ContextMenu
              groups={[
                middle.map((crumb) => ({
                  id: String(crumb.id),
                  label: crumb.name,
                  onSelect: () => onNavigate(crumb.id),
                })),
              ]}
              anchor={menuAnchor}
              ariaLabel="Путь к папке"
              onClose={() => setMenuAnchor(null)}
            />
          )}
        </span>
      ) : (
        middle.map((crumb) => (
          <span className="breadcrumb-group" key={crumb.id}>
            <span className="breadcrumb-sep">/</span>
            <button type="button" className="breadcrumb" onClick={() => onNavigate(crumb.id)}>
              {crumb.name}
            </button>
          </span>
        ))
      )}
      {current ? (
        <>
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb breadcrumb-current">{current.name}</span>
        </>
      ) : null}
    </div>
  );
}
