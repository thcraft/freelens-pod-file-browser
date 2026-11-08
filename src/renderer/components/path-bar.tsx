import { Renderer } from "@freelensapp/extensions";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import styles from "./path-bar.module.scss";

const { Icon, Input } = Renderer.Component;

export interface PathBarProps {
  /** The directory shown, absolute. */
  path: string;
  onNavigate: (path: string) => void;
}

/**
 * The current directory as breadcrumbs: a segment opens that directory, a click anywhere else in the bar turns it
 * into an input for typing a path, which Enter opens and Escape or leaving the input cancels.
 */
export function PathBar({ path, onNavigate }: PathBarProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const startEditing = () => {
    setValue(path);
    setEditing(true);
  };

  const submit = (next: string) => {
    setEditing(false);
    const trimmed = next.trim();
    if (trimmed && trimmed !== path) {
      onNavigate(trimmed);
    }
  };

  if (editing) {
    return (
      <Input
        className={styles.input}
        autoFocus
        autoSelectOnFocus
        value={value}
        onChange={(next) => setValue(next)}
        onSubmit={submit}
        onBlur={() => setEditing(false)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setEditing(false);
          }
        }}
        placeholder="Type a path and press Enter"
      />
    );
  }

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((name, index, all) => ({ name, path: `/${all.slice(0, index + 1).join("/")}` }));

  const open = (target: string) => (event: MouseEvent) => {
    event.stopPropagation();
    if (target !== path) {
      onNavigate(target);
    }
  };

  return (
    <div
      className={styles.bar}
      role="button"
      tabIndex={0}
      title="Click to type a path"
      onClick={startEditing}
      onKeyDown={(event) => {
        // A key on one of the segments is that button's own: it opens the segment.
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          startEditing();
        }
      }}
    >
      <button type="button" className={styles.segment} onClick={open("/")}>
        /
      </button>
      {segments.map((segment, index) => (
        <span key={segment.path} className={styles.group}>
          <button
            type="button"
            className={`${styles.segment} ${index === segments.length - 1 ? styles.current : ""}`}
            onClick={open(segment.path)}
          >
            {segment.name}
          </button>
          {index < segments.length - 1 ? <span className={styles.separator}>/</span> : null}
        </span>
      ))}
      <Icon small material="edit" className={styles.editIcon} />
    </div>
  );
}
