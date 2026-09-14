import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { clipboardUrl } from "../lib/api";
import { NO_LINK_HINT } from "../lib/clipboard";
import { addLink, autoLabel, canRemove, linkPlatform, moveLink, removeLink, setLabel } from "../lib/linksEdit";
import type { EditableLink } from "../lib/linksEdit";
import { Icon, PlatformIcon } from "./Icon";

const DRAG_ACTIVATION = { distance: 4 };

interface LinksEditorProps {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
  onAdded?: (link: EditableLink) => void;
  autoFocusAdd?: boolean;
  onAddPending?: (text: string) => void;
}

interface LinkRowProps {
  link: EditableLink;
  removable: boolean;
  onLabel: (text: string) => void;
  onRemove: () => void;
}

function LinkRow({ link, removable, onLabel, onRemove }: LinkRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: link.key,
  });
  const auto = autoLabel(link.url);
  const dead = link.linkStatus === "dead";
  const style = {
    transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className={"links-edit-row" + (isDragging ? " dragging" : "")}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="links-edit-grip"
        aria-label={`Переставить «${link.label ?? auto}»`}
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" />
      </button>
      <span className={"links-edit-icon" + (dead ? " dead" : "")}>
        <PlatformIcon platform={linkPlatform(link.url)} />
      </span>
      <span className="links-edit-text">
        <span className="links-edit-label-line">
          <input
            className="links-edit-label"
            value={link.label ?? ""}
            placeholder={auto}
            aria-label={`Подпись ссылки ${link.url}`}
            onChange={(e) => onLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          {link.label === null && <span className="links-edit-auto">АВТО</span>}
          {dead && <span className="links-edit-dead">Страницы нет</span>}
        </span>
        <span className="links-edit-url" title={link.url}>
          {link.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
        </span>
      </span>
      <button
        type="button"
        className="links-edit-remove"
        aria-label={removable ? `Убрать ссылку ${link.url}` : "Последнюю ссылку убрать нельзя"}
        title={removable ? "Убрать ссылку" : "Последнюю ссылку убрать нельзя"}
        disabled={!removable}
        onClick={onRemove}
      >
        <Icon name="close" />
      </button>
    </li>
  );
}

export function LinksEditor({ links, onChange, onAdded, autoFocusAdd, onAddPending }: LinksEditorProps) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const noteId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function updateDraft(text: string) {
    setDraft(text);
    setNote(null);
    onAddPending?.(text);
  }

  function commit(text: string): boolean {
    const result = addLink(links, text);
    if (!result.ok) {
      setNote(result.reason);
      return false;
    }
    onChange(result.links);
    onAdded?.(result.added);
    updateDraft("");
    return true;
  }

  function handleAddKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !draft.trim()) return;
    e.preventDefault();
    commit(draft);
  }

  async function addFromClipboard() {
    try {
      const clip = await clipboardUrl();
      if (!clip.url) {
        setNote(NO_LINK_HINT);
        return;
      }
      commit(clip.url);
    } catch {
      setNote(NO_LINK_HINT);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = links.findIndex((link) => link.key === active.id);
    const to = links.findIndex((link) => link.key === over.id);
    onChange(moveLink(links, from, to));
  }

  const removable = canRemove(links);

  return (
    <div className="links-edit">
      <div className="links-edit-head">
        <span className="links-edit-pill">Ссылки · {links.length}</span>
        <span className="links-edit-hint">первая — главная</span>
      </div>
      <div className="links-edit-block">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={links.map((link) => link.key)} strategy={verticalListSortingStrategy}>
            <ul className="links-edit-list">
              {links.map((link) => (
                <LinkRow
                  key={link.key}
                  link={link}
                  removable={removable}
                  onLabel={(text) => onChange(setLabel(links, link.key, text))}
                  onRemove={() => onChange(removeLink(links, link.key))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="links-edit-add">
          <label className="links-edit-add-field">
            <Icon name="link" />
            <input
              value={draft}
              placeholder="https://"
              aria-label="Новая ссылка"
              aria-describedby={note ? noteId : undefined}
              autoFocus={autoFocusAdd}
              onChange={(e) => updateDraft(e.target.value)}
              onKeyDown={handleAddKeyDown}
            />
          </label>
          <button
            type="button"
            className="links-edit-round"
            aria-label="Добавить ссылку из буфера"
            title="Из буфера"
            onClick={addFromClipboard}
          >
            <Icon name="clipboard" />
          </button>
          <button
            type="button"
            className="links-edit-round"
            aria-label="Добавить ссылку"
            title="Добавить"
            disabled={!draft.trim()}
            onClick={() => commit(draft)}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
      {note ? (
        <p className="field-hint" id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
