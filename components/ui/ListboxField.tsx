"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

export type ListboxFieldOption = { value: string; label: string };

export type ListboxKeyModifiers = {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type ListboxKeyState = {
  open: boolean;
  activeIndex: number;
  value: string;
  options: readonly ListboxFieldOption[];
};

export type ListboxKeyAction =
  | {
      type: "none";
      open: boolean;
      activeIndex: number;
      preventDefault: boolean;
      returnFocus: boolean;
    }
  | {
      type: "open";
      open: true;
      activeIndex: number;
      preventDefault: true;
      returnFocus: false;
    }
  | {
      type: "move";
      open: boolean;
      activeIndex: number;
      selectedValue?: string;
      preventDefault: true;
      returnFocus: false;
    }
  | {
      type: "select";
      open: false;
      activeIndex: number;
      selectedValue: string;
      preventDefault: true;
      returnFocus: true;
    }
  | {
      type: "close";
      open: false;
      activeIndex: number;
      preventDefault: boolean;
      returnFocus: boolean;
    };

export function getListboxOptionId(baseId: string, index: number): string {
  if (index < 0) return "";
  return `${baseId}-option-${index}`;
}

export function getSelectedListboxIndex(
  options: readonly ListboxFieldOption[],
  value: string
): number {
  if (options.length === 0) return -1;
  const idx = options.findIndex((o) => o.value === value);
  return idx >= 0 ? idx : 0;
}

export function isListboxTypeAheadKey(
  key: string,
  modifiers: ListboxKeyModifiers = {}
): boolean {
  if (modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey) {
    return false;
  }
  return key.length === 1 && key.trim().length === 1;
}

export function findTypeAheadListboxIndex(
  options: readonly ListboxFieldOption[],
  currentIndex: number,
  key: string
): number {
  if (options.length === 0) return -1;
  const clamped =
    currentIndex >= 0 && currentIndex < options.length ? currentIndex : 0;
  const prefix = key.trim().slice(0, 1).toLocaleLowerCase();
  if (!prefix) return clamped;

  const startIndex =
    currentIndex >= 0 && currentIndex < options.length
      ? (currentIndex + 1) % options.length
      : 0;

  for (let offset = 0; offset < options.length; offset += 1) {
    const idx = (startIndex + offset) % options.length;
    const label = options[idx]?.label.trim().toLocaleLowerCase() ?? "";
    if (label.startsWith(prefix)) {
      return idx;
    }
  }

  return clamped;
}

/**
 * Pure key-to-index reducer for listbox navigation (Up/Down/Home/End and
 * first-letter type-ahead).
 */
export function reduceListboxKeyIndex(
  currentIndex: number,
  key: string,
  options: readonly ListboxFieldOption[],
  modifiers: ListboxKeyModifiers = {}
): number {
  if (options.length === 0) return -1;
  const clamped =
    currentIndex >= 0 && currentIndex < options.length ? currentIndex : 0;

  switch (key) {
    case "ArrowDown":
      return currentIndex < 0 ? 0 : Math.min(options.length - 1, clamped + 1);
    case "ArrowUp":
      return currentIndex < 0 ? 0 : Math.max(0, clamped - 1);
    case "Home":
      return 0;
    case "End":
      return options.length - 1;
    default:
      if (isListboxTypeAheadKey(key, modifiers)) {
        return findTypeAheadListboxIndex(options, currentIndex, key);
      }
      return clamped;
  }
}

/**
 * Pure keyboard state-transition reducer covering both closed-trigger and
 * open-listbox interactions.
 */
export function reduceListboxKeyAction(
  state: ListboxKeyState,
  key: string,
  modifiers: ListboxKeyModifiers = {}
): ListboxKeyAction {
  const { open, activeIndex, value, options } = state;
  const selectedIndex = getSelectedListboxIndex(options, value);

  if (!open) {
    if (
      key === "ArrowDown" ||
      key === "ArrowUp" ||
      key === "Enter" ||
      key === " "
    ) {
      return {
        type: "open",
        open: true,
        activeIndex: selectedIndex,
        preventDefault: true,
        returnFocus: false,
      };
    }
    if (key === "Home") {
      return {
        type: "open",
        open: true,
        activeIndex: options.length > 0 ? 0 : -1,
        preventDefault: true,
        returnFocus: false,
      };
    }
    if (key === "End") {
      return {
        type: "open",
        open: true,
        activeIndex: options.length > 0 ? options.length - 1 : -1,
        preventDefault: true,
        returnFocus: false,
      };
    }
    if (isListboxTypeAheadKey(key, modifiers)) {
      const nextIndex = reduceListboxKeyIndex(
        selectedIndex,
        key,
        options,
        modifiers
      );
      const matched = nextIndex >= 0 ? options[nextIndex] : undefined;
      if (matched) {
        return {
          type: "move",
          open: false,
          activeIndex: nextIndex,
          selectedValue: matched.value,
          preventDefault: true,
          returnFocus: false,
        };
      }
    }
    return {
      type: "none",
      open: false,
      activeIndex,
      preventDefault: false,
      returnFocus: false,
    };
  }

  if (key === "Escape") {
    return {
      type: "close",
      open: false,
      activeIndex: selectedIndex,
      preventDefault: true,
      returnFocus: true,
    };
  }

  if (key === "Tab") {
    return {
      type: "close",
      open: false,
      activeIndex: selectedIndex,
      preventDefault: false,
      returnFocus: false,
    };
  }

  if (key === "Enter" || key === " ") {
    const targetIndex =
      activeIndex >= 0 && activeIndex < options.length
        ? activeIndex
        : selectedIndex;
    const selectedOption = targetIndex >= 0 ? options[targetIndex] : undefined;
    if (selectedOption) {
      return {
        type: "select",
        open: false,
        activeIndex: targetIndex,
        selectedValue: selectedOption.value,
        preventDefault: true,
        returnFocus: true,
      };
    }
    return {
      type: "close",
      open: false,
      activeIndex: -1,
      preventDefault: true,
      returnFocus: true,
    };
  }

  if (
    key === "ArrowDown" ||
    key === "ArrowUp" ||
    key === "Home" ||
    key === "End" ||
    isListboxTypeAheadKey(key, modifiers)
  ) {
    const nextIndex = reduceListboxKeyIndex(
      activeIndex,
      key,
      options,
      modifiers
    );
    return {
      type: "move",
      open: true,
      activeIndex: nextIndex,
      preventDefault: true,
      returnFocus: false,
    };
  }

  return {
    type: "none",
    open: true,
    activeIndex,
    preventDefault: false,
    returnFocus: false,
  };
}

export type ListboxFieldProps = {
  /** id estable para accesibilidad (sin espacios) */
  id: string;
  label: string;
  value: string;
  options: ListboxFieldOption[];
  onChange: (value: string) => void;
  /** Si el botón necesita aria-label distinto del texto visible */
  ariaLabel?: string;
};

/**
 * Desplegable estilo Explorer (SORT BY): trigger tipo `input` + panel listbox con portal
 * para no quedar recortado bajo `overflow-hidden` (p. ej. GlassCard).
 */
export default function ListboxField({
  id,
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: ListboxFieldProps) {
  const reactId = useId();
  const baseId = `${id}-${reactId.replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    getSelectedListboxIndex(options, value)
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  const resolvedActiveIndex =
    activeIndex >= 0 && activeIndex < options.length
      ? activeIndex
      : getSelectedListboxIndex(options, value);

  const activeOptionId =
    open && resolvedActiveIndex >= 0
      ? getListboxOptionId(baseId, resolvedActiveIndex)
      : undefined;

  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: r.left,
      width: r.width,
    });
  }, []);

  const applyKeyAction = useCallback(
    (action: ListboxKeyAction) => {
      if (action.type === "none") return;
      setOpen(action.open);
      setActiveIndex(action.activeIndex);
      if (action.type === "select") {
        onChange(action.selectedValue);
      } else if (action.type === "move" && action.selectedValue !== undefined) {
        onChange(action.selectedValue);
      }
      if (action.returnFocus) {
        triggerRef.current?.focus();
      }
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const action = reduceListboxKeyAction(
        {
          open,
          activeIndex: resolvedActiveIndex,
          value,
          options,
        },
        e.key,
        {
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
        }
      );
      if (action.preventDefault) {
        e.preventDefault();
      }
      applyKeyAction(action);
    },
    [applyKeyAction, open, options, resolvedActiveIndex, value]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setActiveIndex(getSelectedListboxIndex(options, value));
    }
  }, [open, options, value]);

  useEffect(() => {
    if (!open || !activeOptionId || typeof document === "undefined") return;
    const optionEl = document.getElementById(activeOptionId);
    optionEl?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeOptionId]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = reduceListboxKeyAction(
        {
          open: true,
          activeIndex: resolvedActiveIndex,
          value,
          options,
        },
        e.key,
        {
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
        }
      );
      if (action.type === "none") return;
      if (action.preventDefault) {
        e.preventDefault();
      }
      applyKeyAction(action);
    };
    const onScrollResize = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [applyKeyAction, open, options, resolvedActiveIndex, updatePos, value]);

  const listboxId = `${baseId}-listbox`;
  const labelId = `${baseId}-label`;
  const triggerId = `${baseId}-trigger`;

  const panel =
    mounted &&
    typeof document !== "undefined" &&
    open &&
    pos &&
    createPortal(
      <motion.div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        tabIndex={-1}
        aria-labelledby={labelId}
        aria-activedescendant={activeOptionId}
        onKeyDown={handleKeyDown}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 80,
        }}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="overflow-hidden rounded border border-pv-ink/[0.1] bg-pv-bg py-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.85)]"
      >
        {options.map((opt, index) => {
          const isSelected = value === opt.value;
          const isActive = index === resolvedActiveIndex;
          const optionId = getListboxOptionId(baseId, index);
          return (
            <button
              key={opt.value}
              id={optionId}
              type="button"
              role="option"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isSelected}
              data-active={isActive ? "true" : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setActiveIndex(index);
                triggerRef.current?.focus();
              }}
              className={`flex w-full items-center px-4 py-2.5 text-left font-body text-sm transition-colors ${
                isSelected
                  ? "bg-pv-emerald/[0.12] font-medium text-pv-emerald"
                  : isActive
                    ? "bg-pv-ink/[0.08] text-pv-text"
                    : "text-pv-muted hover:bg-pv-ink/[0.05] hover:text-pv-text"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </motion.div>,
      document.body
    );

  return (
    <div ref={wrapRef} className="min-w-0 space-y-2">
      <label
        id={labelId}
        htmlFor={triggerId}
        className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted"
      >
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        onKeyDown={handleKeyDown}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              setActiveIndex(getSelectedListboxIndex(options, value));
            }
            return next;
          });
        }}
        className="input flex h-11 min-h-[44px] w-full cursor-pointer items-center justify-between gap-2 bg-pv-bg py-0 pr-3 text-left font-body text-sm text-pv-text transition-[border-color,box-shadow] hover:border-pv-ink/[0.14]"
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-pv-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {panel}
    </div>
  );
}
