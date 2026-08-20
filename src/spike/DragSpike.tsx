import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

function DragCard() {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: "spike-card",
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className="spike-card"
    >
      Перетащи меня
    </div>
  );
}

function DropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: "spike-zone" });

  return (
    <div ref={setNodeRef} className={`spike-zone ${isOver ? "is-over" : ""}`}>
      Зона приёма
    </div>
  );
}

export function DragSpike() {
  const [dndKitEvent, setDndKitEvent] = useState("(ничего)");
  const [tauriEvent, setTauriEvent] = useState("(ничего)");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlisten = webview.onDragDropEvent((event) => {
      setTauriEvent(JSON.stringify(event.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setDndKitEvent(`dragStart: ${event.active.id}`);
  }

  function handleDragOver(event: DragOverEvent) {
    setDndKitEvent(`dragOver: ${event.over?.id ?? "(вне зоны)"}`);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDndKitEvent(`dragEnd: ${event.over?.id ?? "(вне зоны)"}`);
  }

  return (
    <div className="spike">
      <h2>Спайк D-23: dnd-kit против dragDropEnabled</h2>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="spike-row">
          <DragCard />
          <DropZone />
        </div>
      </DndContext>
      <p>dnd-kit: {dndKitEvent}</p>
      <p>onDragDropEvent (брось ссылку из Chrome): {tauriEvent}</p>
    </div>
  );
}
