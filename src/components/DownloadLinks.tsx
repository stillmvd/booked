import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { downloadDomain, isMaskedLink, withV } from "../lib/gameFormat";
import type { DownloadLink } from "../lib/types";
import { Icon } from "./Icon";

const HOVER_OPEN = 120;
const HOVER_CLOSE = 220;
const POP_GAP = 8;
const POP_MARGIN = 12;

function DownloadRows({ links, onOpen }: { links: DownloadLink[]; onOpen: (index: number) => void }) {
  return (
    <div className="dl-rows">
      {links.map((link, index) => {
        const masked = isMaskedLink(link.url);
        return (
          <button
            key={`${index}-${link.url}`}
            type="button"
            className="dl-row"
            title={masked ? "Откроется, если в браузере выполнен вход на F95zone" : link.url}
            onClick={() => onOpen(index)}
          >
            {masked ? <Icon name="lock" className="dl-lock" /> : null}
            <span className="dl-host">{link.host}</span>
            <span className="dl-dom">{downloadDomain(link.url)}</span>
            <span className="dl-go" aria-hidden="true">
              <Icon name="arrow-up-right" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface DownloadProps {
  links: DownloadLink[];
  version: string | null;
  onOpen: (index: number) => void;
}

export function DownloadBlock({ links, version, onOpen }: DownloadProps) {
  const labelId = useId();
  return (
    <div className="dl" role="group" aria-labelledby={labelId}>
      <p className="game-panel-label dl-label" id={labelId}>
        Скачать {version ? <b>{withV(version)}</b> : null}
      </p>
      <DownloadRows links={links} onOpen={onOpen} />
    </div>
  );
}

export function DownloadButton({ links, version, onOpen }: DownloadProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const popId = useId();

  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const anchor = button.current?.getBoundingClientRect();
      const el = pop.current;
      if (!anchor || !el) return;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const left = Math.min(Math.max(POP_MARGIN, anchor.right - width), window.innerWidth - POP_MARGIN - width);
      const below = anchor.bottom + POP_GAP;
      const top = below + height <= window.innerHeight - POP_MARGIN ? below : Math.max(POP_MARGIN, anchor.top - POP_GAP - height);
      setPos({ left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, links.length]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    function onDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    }
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="dl-btn"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && later(true, HOVER_OPEN)}
        onPointerLeave={(e) => e.pointerType === "mouse" && later(false, HOVER_CLOSE)}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen((was) => !was);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>(".dl-row")?.focus());
        }}
      >
        Скачать
        {version ? <small>{withV(version)}</small> : null}
        <span className="dl-btn-chevron" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={pop}
              id={popId}
              className={"dl-pop" + (pos ? " open" : "")}
              style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
              onPointerEnter={() => window.clearTimeout(timer.current)}
              onPointerLeave={(e) => e.pointerType === "mouse" && later(false, HOVER_CLOSE)}
            >
              <DownloadRows
                links={links}
                onOpen={(index) => {
                  setOpen(false);
                  onOpen(index);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
