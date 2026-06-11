'use client';

/**
 * SearchableSelect — reusable combobox that replaces native <select> for
 * data-driven dropdowns (pages, pixels, audiences, catalogs, product sets,
 * country, locales).
 *
 * Closed-state appearance is identical to the project's existing select
 * elements (same Tailwind inputBase classes).
 *
 * Keyboard: ArrowDown/ArrowUp navigate the list, Enter selects, Escape closes.
 * Click-outside closes.
 * Accent-insensitive substring match over label + sublabel.
 * Optional group headers preserve group order.
 * Clearable (default true) shows an ×  affordance in the trigger.
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  KeyboardEvent,
} from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SSOption = {
  value: string;
  label: string;
  sublabel?: string;
  group?: string;
};

// ─── Pure filter function (exported for unit tests) ─────────────────────────

/**
 * Accent-insensitive, case-insensitive substring match over label + sublabel.
 * Empty query returns all options unchanged (preserving group order).
 */
export function filterOptions(options: SSOption[], query: string): SSOption[] {
  if (!query.trim()) return options;
  const normalised = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return options.filter(o => {
    const label = o.label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    const sub = (o.sublabel ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return label.includes(normalised) || sub.includes(normalised);
  });
}

// ─── Tailwind class helpers ──────────────────────────────────────────────────

function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// Matches the project-wide inputBase from ClientCampaignBuilder.tsx
const inputBase =
  'text-xs px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50';

// ─── Component ───────────────────────────────────────────────────────────────

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecionar…',
  disabled = false,
  loading = false,
  clearable = true,
  className,
}: {
  options: SSOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Derived data ─────────────────────────────────────────────────────────

  const selected = options.find(o => o.value === value) ?? null;

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  // Preserve group order: collect groups in their first-appearance order.
  const groups = useMemo(() => {
    const seen: string[] = [];
    for (const o of filtered) {
      const g = o.group ?? '';
      if (!seen.includes(g)) seen.push(g);
    }
    return seen;
  }, [filtered]);

  // Flat ordered list for keyboard navigation (same order as rendered).
  const flatItems = useMemo(
    () => groups.flatMap(g => filtered.filter(o => (o.group ?? '') === g)),
    [groups, filtered],
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIdx(-1);
  }, []);

  const select = useCallback(
    (v: string | null) => {
      onChange(v);
      close();
    },
    [onChange, close],
  );

  // ── Effects ───────────────────────────────────────────────────────────────

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Reset active index when filtered list changes.
  useEffect(() => {
    setActiveIdx(-1);
  }, [query]);

  // Scroll active item into view.
  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // ── Keyboard handler on the search input ─────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, flatItems.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && flatItems[activeIdx]) {
        select(flatItems[activeIdx].value);
      }
    }
  };

  // ── Trigger button keyboard handler (closed state) ────────────────────────

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const showClear = clearable && value !== null && !disabled;
  const displayLabel = selected ? selected.label : placeholder;
  const isPlaceholder = selected === null;

  return (
    <div ref={containerRef} className={cls('relative', className)}>
      {/* ── Trigger (closed state) ── */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) setOpen(o => !o);
          }}
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cls(
            inputBase,
            'w-full text-left flex justify-between items-center gap-2',
            disabled && 'cursor-not-allowed',
          )}
        >
          <span
            className={cls(
              'truncate flex-1',
              isPlaceholder
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-800 dark:text-gray-100',
            )}
          >
            {loading ? 'Carregando…' : displayLabel}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {showClear && (
              <span
                role="button"
                aria-label="Limpar seleção"
                tabIndex={0}
                onClick={e => {
                  e.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    onChange(null);
                  }
                }}
                className="text-gray-400 dark:text-gray-500 hover:text-rose-500 dark:hover:text-rose-400 text-sm font-bold leading-none cursor-pointer px-0.5"
              >
                ×
              </span>
            )}
            <span className="text-gray-400 dark:text-gray-500 text-[10px]">
              {open ? '▲' : '▼'}
            </span>
          </span>
        </button>
      </div>

      {/* ── Dropdown (open state) ── */}
      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg flex flex-col overflow-hidden"
        >
          {/* Search input — autofocused */}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar…"
            className="text-xs px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none focus:border-indigo-300"
          />

          {/* Options list */}
          <div ref={listRef} className="overflow-y-auto max-h-56">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 px-3 py-2 italic">
                {options.length === 0
                  ? 'Nenhuma opção disponível'
                  : `Nenhum resultado para "${query}"`}
              </p>
            ) : (
              groups.map(group => {
                const groupItems = filtered.filter(
                  o => (o.group ?? '') === group,
                );
                return (
                  <div key={group}>
                    {/* Group header (only rendered when group name is non-empty) */}
                    {group !== '' && (
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 select-none">
                        {group}
                      </div>
                    )}
                    {groupItems.map(o => {
                      const idx = flatItems.indexOf(o);
                      const isActive = idx === activeIdx;
                      const isSelected = o.value === value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          data-idx={idx}
                          onClick={() => select(o.value)}
                          onMouseEnter={() => setActiveIdx(idx)}
                          className={cls(
                            'block w-full text-left px-3 py-1.5 text-xs',
                            'hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-400',
                            isSelected &&
                              'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-semibold',
                            isActive &&
                              !isSelected &&
                              'bg-gray-50 dark:bg-gray-800',
                          )}
                        >
                          <span className="truncate">{o.label}</span>
                          {o.sublabel && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">
                              ({o.sublabel})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
