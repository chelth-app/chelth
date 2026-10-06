"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

export type DetailsTab = { id: string; label: string; content: ReactNode };

/**
 * In-place drawer tabs (locked Workforce "Professional Details"): an ARIA
 * tablist with roving focus and arrow-key navigation. Panels are rendered by
 * the server and passed in; only the selection lives here.
 */
export function DetailsTabs({ tabs, label }: { tabs: readonly DetailsTab[]; label: string }) {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col">
      <div
        role="tablist"
        aria-label={label}
        className="flex h-[44px] items-stretch gap-7 border-b border-[rgba(18,107,103,0.14)]"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-controls={`${baseId}-panel-${tab.id}`}
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative -mb-px px-0.5 text-[14.5px] whitespace-nowrap transition-colors",
              "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:content-['']",
              selected === index
                ? "font-semibold text-[color-mix(in_srgb,var(--chelth-navy)_72%,black)] after:bg-primary"
                : "font-medium text-slate-500 after:bg-transparent hover:text-chelth-navy",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={selected !== index}
          className="pt-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
