import { useLayoutEffect, useRef, useState } from "react";

import type { Crumb } from "../lib/types";

interface BreadcrumbsProps {
  crumbs: Crumb[];
  onNavigate: (id: number | null) => void;
}

export function Breadcrumbs({ crumbs, onNavigate }: BreadcrumbsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useLayoutEffect(() => {
    setCollapsed(false);
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
        Trove
      </button>
      {showEllipsis ? (
        <span className="breadcrumb-group">
          <span className="breadcrumb-sep">/</span>
          <span className="breadcrumb-ellipsis">…</span>
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
