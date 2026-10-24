import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ORDER_DIRECTIONS, ORDER_LABELS, type Order, type OrderKey, type RateFilter } from "../lib/gameFilters";
import { pluralizeRu } from "../lib/pluralizeRu";
import { Icon } from "./Icon";

interface GamesFilterPopoverProps {
  anchorId: string;
  orders: OrderKey[];
  order: Order;
  onOrder: (key: OrderKey) => void;
  rate: RateFilter | undefined;
  rated: number;
  unrated: number;
  onRate: (rate: RateFilter) => void;
  engines: [string, number][];
  engineTotal: number;
  engine: string | null;
  onEngine: (engine: string | null) => void;
  onReset: () => void;
  onClose: (restoreFocus: boolean) => void;
}

export function GamesFilterPopover({
  anchorId,
  orders,
  order,
  onOrder,
  rate,
  rated,
  unrated,
  onRate,
  engines,
  engineTotal,
  engine,
  onEngine,
  onReset,
  onClose,
}: GamesFilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [hoverStar, setHoverStar] = useState(0);

  useLayoutEffect(() => {
    function place() {
      const el = ref.current;
      const anchor = document.getElementById(anchorId)?.getBoundingClientRect();
      if (!el || !anchor) return;
      const margin = 12;
      const left = Math.min(Math.max(margin, anchor.right - el.offsetWidth), window.innerWidth - margin - el.offsetWidth);
      const top = Math.max(margin, Math.min(anchor.bottom + 8, window.innerHeight - margin - el.offsetHeight));
      setPos({ left, top });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorId, engines.length, rate === undefined, rate !== null && rate !== undefined]);

  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    const frame = requestAnimationFrame(() => setOpen(true));
    ref.current?.querySelector<HTMLElement>(".games-filter-row[aria-checked='true']")?.focus();
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
      const target = e.target as Node;
      if (ref.current?.contains(target) || document.getElementById(anchorId)?.contains(target)) return;
      onCloseRef.current(false);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [anchorId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button") ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = index <= 0 ? items.length - 1 : index - 1;
    items[next].focus();
  }

  const shownStars = hoverStar || (typeof rate === "number" ? rate : 0);
  const active = (rate !== undefined && rate !== null) || engine !== null;

  return createPortal(
    <div
      ref={ref}
      className={"games-filter-pop" + (open && pos ? " open" : "")}
      role="dialog"
      aria-modal="false"
      aria-label="Фильтры"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={handleKeyDown}
    >
      <div className="games-filter-head" id="games-filter-order">
        Порядок
      </div>
      <div role="radiogroup" aria-labelledby="games-filter-order">
        {orders.map((key) => {
          const on = order.key === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              className="games-filter-row"
              title={on ? `${ORDER_DIRECTIONS[key][order.flip ? 1 : 0]}. Нажмите, чтобы развернуть` : undefined}
              onClick={() => onOrder(key)}
            >
              <span className="games-filter-name">{ORDER_LABELS[key]}</span>
              {on ? (
                <span className="games-filter-dir" aria-label={ORDER_DIRECTIONS[key][order.flip ? 1 : 0]}>
                  <Icon name={order.flip ? "arrow-up" : "arrow-down"} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {rate !== undefined ? (
        <>
          <div className="games-filter-sep" />
          <div className="games-filter-head">Оценка</div>
          <div className="games-filter-rate">
            <div className="games-filter-stars" onPointerLeave={() => setHoverStar(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={"games-filter-star" + (n <= shownStars ? " on" : "")}
                  aria-label={n === 5 ? "5 звёзд" : `От ${n} и выше`}
                  aria-pressed={rate === n}
                  onPointerEnter={() => setHoverStar(n)}
                  onClick={() => onRate(rate === n ? null : n)}
                >
                  <Icon name={n <= shownStars ? "star-fill" : "star"} />
                </button>
              ))}
            </div>
            {typeof rate === "number" ? (
              <span className="games-filter-hint">
                <span>
                  От <b>{rate}</b> {pluralizeRu(rate, ["звезды", "звёзд", "звёзд"])}
                </span>
                <span>{rated}</span>
              </span>
            ) : null}
            <button
              type="button"
              className="games-filter-unrated"
              aria-pressed={rate === "none"}
              onClick={() => onRate(rate === "none" ? null : "none")}
            >
              <span className="games-filter-name">Без оценки</span>
              <small>{unrated}</small>
            </button>
          </div>
        </>
      ) : null}

      <div className="games-filter-sep" />
      <div className="games-filter-head" id="games-filter-engine">
        Движок
      </div>
      <div role="radiogroup" aria-labelledby="games-filter-engine">
        <button
          type="button"
          role="radio"
          aria-checked={engine === null}
          className="games-filter-row"
          onClick={() => onEngine(null)}
        >
          <span className="games-filter-name">Все движки</span>
          <small>{engineTotal}</small>
          {engine === null ? <Icon name="check" className="games-filter-check" /> : null}
        </button>
        {engines.map(([name, count]) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={engine === name}
            className="games-filter-row"
            onClick={() => onEngine(name)}
          >
            <i className="games-filter-dot" data-engine={name} aria-hidden="true" />
            <span className="games-filter-name">{name}</span>
            <small>{count}</small>
            {engine === name ? <Icon name="check" className="games-filter-check" /> : null}
          </button>
        ))}
      </div>

      {active ? (
        <div className="games-filter-foot">
          <button type="button" className="games-filter-reset" onClick={onReset}>
            Сбросить фильтры
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
