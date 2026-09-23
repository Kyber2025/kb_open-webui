import { useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, TriangleAlert } from "lucide-react";
import type { Model } from "../lib/types";
import {
  effortOptions,
  modelDescription,
  modelLabel,
  primaryModels,
  supportsEffort,
  type Effort,
} from "../lib/model-menu";

export function ModelPicker({
  models,
  selected,
  effort,
  onModel,
  onEffort,
  onClose,
}: {
  models: Model[];
  selected: string;
  effort: Effort;
  onModel: (model: Model) => void;
  onEffort: (effort: Effort) => void;
  onClose: () => void;
}) {
  const [sub, setSub] = useState<"effort" | "more" | null>(null);
  const [query, setQuery] = useState("");
  const [left, setLeft] = useState(false);
  const [compact, setCompact] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const effortTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const primary = primaryModels(models);
  const extras = models.filter((m) => !primary.some((p) => p.id === m.id));
  const current = models.find((m) => m.id === selected);
  const hasEffort = supportsEffort(current);
  const effortLabel = effortOptions.find((e) => e.value === effort)!.label;
  useLayoutEffect(() => {
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      setCompact(innerWidth <= 760);
      if (box) setLeft(box.right + 325 > innerWidth - 16);
    };
    measure();
    root.current
      ?.querySelector<HTMLElement>('button[aria-checked="true"],button')
      ?.focus();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useLayoutEffect(() => {
    if (sub) panel.current?.querySelector<HTMLElement>("input,button")?.focus();
  }, [sub]);
  function back() {
    const trigger = sub === "effort" ? effortTrigger : moreTrigger;
    setSub(null);
    trigger.current?.focus();
  }
  function moveFocus(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      sub ? back() : onClose();
      return;
    }
    if (e.key === "ArrowLeft" && sub) {
      e.preventDefault();
      back();
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    e.preventDefault();
    items[next]?.focus();
  }
  const option = (model: Model) => (
    <button
      type="button"
      key={model.id}
      role="menuitemradio"
      aria-checked={model.id === selected}
      className="model-option"
      onClick={() => onModel(model)}
    >
      <span>
        <strong>{modelLabel(model)}</strong>
        <small>{modelDescription(model)}</small>
      </span>
      {model.id === selected && <Check size={17} className="selection-check" />}
    </button>
  );
  return (
    <>
      <button
        type="button"
        className="dismiss-layer"
        aria-label="Close model menu"
        onClick={onClose}
      />
      <div
        ref={root}
        className={`popover claude-model-menu ${left ? "submenu-left" : ""} ${compact && sub ? "show-submenu" : ""}`}
      >
        {(!compact || !sub) && (
          <div role="menu" aria-label="Models and effort" onKeyDown={moveFocus}>
            <div className="primary-model-list">
              {primary.map(option)}
              {!primary.length && (
                <p className="popover-note">
                  No models available for this account.
                </p>
              )}
            </div>
            {hasEffort && (
              <>
                <div className="menu-rule" />
                <button
                  type="button"
                  ref={effortTrigger}
                  className={`submenu-trigger ${sub === "effort" ? "is-open" : ""}`}
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={sub === "effort"}
                  onMouseEnter={() => {
                    if (!compact) setSub("effort");
                  }}
                  onClick={() => setSub("effort")}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      setSub("effort");
                    }
                  }}
                >
                  <span>Effort</span>
                  <span className="submenu-value">
                    {effortLabel}
                    <ChevronRight size={15} />
                  </span>
                </button>
              </>
            )}
            <div className="menu-rule" />
            <button
              type="button"
              ref={moreTrigger}
              className={`submenu-trigger ${sub === "more" ? "is-open" : ""}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub === "more"}
              onMouseEnter={() => {
                if (!compact) setSub("more");
              }}
              onClick={() => setSub("more")}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  setSub("more");
                }
              }}
            >
              More models
              <ChevronRight size={15} />
            </button>
          </div>
        )}
        {sub && (
          <div
            ref={panel}
            className={`model-submenu ${sub}`}
            role="menu"
            aria-label={sub === "effort" ? "Reasoning effort" : "More models"}
            onKeyDown={(e) => {
              e.stopPropagation();
              moveFocus(e);
            }}
          >
            {compact && (
              <button className="submenu-back" type="button" onClick={back}>
                <ArrowLeft size={15} />
                {sub === "effort" ? "Effort" : "More models"}
              </button>
            )}
            {sub === "effort" ? (
              <>
                <p className="effort-explanation">
                  Higher effort means more thorough responses, but takes longer
                  and uses your limits faster.
                </p>
                {effortOptions.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    role="menuitemradio"
                    aria-checked={effort === item.value}
                    className="effort-option"
                    onClick={() => onEffort(item.value)}
                  >
                    <span>{item.label}</span>
                    {item.value === "medium" && (
                      <small className="default-badge">Default</small>
                    )}
                    {item.value === "max" && (
                      <small className="usage-badge">
                        <TriangleAlert size={11} />
                        Higher usage
                      </small>
                    )}
                    {effort === item.value && (
                      <Check size={17} className="selection-check" />
                    )}
                  </button>
                ))}
              </>
            ) : (
              <>
                <input
                  aria-label="Search more models"
                  placeholder="Search models…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="more-model-list">
                  {extras
                    .filter((m) =>
                      `${m.name} ${m.id}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map(option)}
                  {!extras.some((m) =>
                    `${m.name} ${m.id}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  ) && (
                    <p className="popover-note">No other matching models.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
