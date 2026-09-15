import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { browserDefaultGet, browserDefaultSet, browserList, mediaPath } from "../lib/api";
import {
  NONE_TARGET,
  browserCaption,
  profileTargets,
  radioStep,
  selectedEntryIndex,
  selectedProfileIndex,
  targetsMatch,
} from "../lib/browserPick";
import { avatarRelPath } from "../lib/media";
import { tint } from "../lib/plate";
import { currentTheme } from "../lib/theme";
import type { BrowserEntry, BrowserTarget } from "../lib/types";
import { BrowserIcon } from "./BrowserIcon";
import { Icon } from "./Icon";
import { ShowcaseNote } from "./ShowcaseNote";

interface BrowserPickerProps {
  value: BrowserTarget;
  onChange: (target: BrowserTarget) => void;
  onDefaultError?: (message: string) => void;
  hint?: string | null;
  showDefault?: boolean;
}

function ProfileAvatar({ avatarFile, profileKey, letter }: { avatarFile: string | null | undefined; profileKey: string; letter: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    if (!avatarFile) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    mediaPath(avatarRelPath(avatarFile)).then((full) => {
      if (!cancelled) setSrc(convertFileSrc(full));
    });
    return () => {
      cancelled = true;
    };
  }, [avatarFile]);

  const swatch = tint(profileKey, currentTheme());
  const showImg = loaded && src;

  return (
    <span className="browser-avatar" style={showImg ? undefined : { background: swatch.bg }}>
      {src && (
        <img
          className="browser-avatar-img"
          src={src}
          alt=""
          style={loaded ? undefined : { display: "none" }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      {!showImg && (
        <span className="browser-avatar-letter" style={{ color: swatch.fg }}>
          {letter}
        </span>
      )}
    </span>
  );
}

export function BrowserPicker({ value, onChange, onDefaultError, hint, showDefault = true }: BrowserPickerProps) {
  const [entries, setEntries] = useState<BrowserEntry[]>([]);
  const [defaultTarget, setDefaultTarget] = useState<BrowserTarget>(NONE_TARGET);
  const circleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();

  useEffect(() => {
    browserList().then(setEntries);
    browserDefaultGet().then(setDefaultTarget);
  }, []);

  const entryIndex = selectedEntryIndex(entries, value);
  const entry = entryIndex >= 0 ? entries[entryIndex] : null;
  const circleIndex = !value.browser ? 0 : entryIndex >= 0 ? entryIndex + 1 : -1;
  const circleTargets: BrowserTarget[] = [NONE_TARGET, ...entries.map((item) => profileTargets(item)[0])];
  const chipTargets = entry ? profileTargets(entry) : [];
  const chipIndex = entry ? selectedProfileIndex(entry, value) : -1;
  const caption = browserCaption(entries, value);
  const isDefault = targetsMatch(value, defaultTarget);

  async function handleDefaultToggle() {
    const next = isDefault ? NONE_TARGET : value;
    try {
      await browserDefaultSet(next);
      setDefaultTarget(next);
    } catch (err) {
      onDefaultError?.(err instanceof Error ? err.message : String(err));
    }
  }

  function pickCircle(index: number) {
    if (index === circleIndex) return;
    onChange(circleTargets[index]);
  }

  function handleCircleKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = radioStep(e.key, index, circleTargets.length);
    if (next === null) return;
    e.preventDefault();
    pickCircle(next);
    circleRefs.current[next]?.focus();
  }

  function handleChipKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = radioStep(e.key, index, chipTargets.length);
    if (next === null) return;
    e.preventDefault();
    onChange(chipTargets[next]);
    chipRefs.current[next]?.focus();
  }

  return (
    <div className="field browser-field">
      <span className="field-label" id={labelId}>
        Браузер
      </span>
      <div className="browser-top">
        <div className="browser-circles" role="radiogroup" aria-labelledby={labelId}>
          {circleTargets.map((_, index) => {
            const item = index === 0 ? null : entries[index - 1];
            const label = item ? item.name : "Без назначения — как обычно";
            const selected = index === circleIndex;
            return (
              <button
                key={item ? item.key : ""}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                tabIndex={index === Math.max(0, circleIndex) ? 0 : -1}
                className="browser-circle"
                ref={(el) => {
                  circleRefs.current[index] = el;
                }}
                onClick={() => pickCircle(index)}
                onKeyDown={(e) => handleCircleKey(e, index)}
              >
                {item ? <BrowserIcon iconKey={item.iconKey} name={item.name} /> : <Icon name="blocked" />}
              </button>
            );
          })}
        </div>
        <div className="browser-caption">
          <span className="browser-caption-name">{caption.name}</span>
          <span className="browser-caption-sub">{caption.sub}</span>
        </div>
        {showDefault && entry ? (
          <button
            type="button"
            className="browser-star"
            aria-pressed={isDefault}
            aria-label={isDefault ? "Вариант по умолчанию для новых закладок" : "Сделать вариантом по умолчанию для новых закладок"}
            title={isDefault ? "Вариант по умолчанию для новых закладок" : "Сделать вариантом по умолчанию для новых закладок"}
            onClick={handleDefaultToggle}
          >
            <Icon name={isDefault ? "star-fill" : "star"} />
          </button>
        ) : null}
      </div>
      {entry && entry.profiles.length > 0 ? (
        <div className="browser-chips" role="radiogroup" aria-label={`Профиль ${entry.name}`}>
          {chipTargets.map((target, index) => {
            const profile = index === 0 ? null : entry.profiles[index - 1];
            const selected = index === chipIndex;
            const chipDefault = targetsMatch(target, defaultTarget);
            return (
              <button
                key={profile ? profile.key : ""}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={chipDefault ? `${profile ? profile.name : "Любой профиль"}, по умолчанию` : undefined}
                tabIndex={selected || (chipIndex < 0 && index === 0) ? 0 : -1}
                className={"browser-chip" + (profile ? "" : " browser-chip-any")}
                ref={(el) => {
                  chipRefs.current[index] = el;
                }}
                onClick={() => onChange(target)}
                onKeyDown={(e) => handleChipKey(e, index)}
              >
                {profile ? (
                  <ProfileAvatar
                    avatarFile={profile.avatarFile}
                    profileKey={`${entry.key}::${profile.key}`}
                    letter={profile.name.charAt(0).toUpperCase()}
                  />
                ) : (
                  <BrowserIcon iconKey={entry.iconKey} name={entry.name} />
                )}
                <span className="browser-chip-label">{profile ? profile.name : "Любой профиль"}</span>
                {chipDefault ? <Icon name="star-fill" className="browser-chip-star" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {entries.length === 0 ? <p className="browser-empty">Другие браузеры не найдены на этом компьютере</p> : null}
      {hint ? (
        <ShowcaseNote icon="folder" className="browser-note">
          {hint}
        </ShowcaseNote>
      ) : null}
    </div>
  );
}
