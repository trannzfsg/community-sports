"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseDateParts(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value?: string) {
  const date = parseDateParts(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  min?: string;
};

export default function DatePicker({ value, onChange, required, min }: DatePickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = parseDateParts(value);
  const minDate = parseDateParts(min);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const base = selectedDate ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-AU", {
      month: "long",
      year: "numeric",
    }).format(visibleMonth);
  }, [visibleMonth]);

  const calendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const lastOfMonth = new Date(year, month + 1, 0);
    const mondayFirstOffset = (firstOfMonth.getDay() + 6) % 7;
    const cells: Array<Date | null> = [];

    for (let i = 0; i < mondayFirstOffset; i += 1) {
      cells.push(null);
    }

    for (let day = 1; day <= lastOfMonth.getDate(); day += 1) {
      cells.push(new Date(year, month, day));
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [visibleMonth]);

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function isDisabled(date: Date) {
    return !!minDate && date.getTime() < minDate.getTime();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          if (!open) {
            const base = selectedDate ?? new Date();
            setVisibleMonth(new Date(base.getFullYear(), base.getMonth(), 1));
          }
          setOpen((current) => !current);
        }}
        className="flex w-full items-center justify-between rounded-xl border border-zinc-300 bg-white px-4 py-3 text-left outline-none transition focus:border-zinc-500"
      >
        <span className={value ? "text-zinc-900" : "text-zinc-400"}>
          {value ? formatDisplayDate(value) : "Select date"}
        </span>
        <span className="text-sm text-zinc-500">📅</span>
      </button>
      <input type="hidden" value={value} required={required} readOnly />

      {open ? (
        <div className="absolute z-20 mt-2 w-[320px] rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
            >
              ←
            </button>
            <div className="text-sm font-semibold text-zinc-900">{monthLabel}</div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
            >
              →
            </button>
          </div>

          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-medium text-zinc-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-10" />;
              }

              const selected = selectedDate ? isSameDay(date, selectedDate) : false;
              const today = isSameDay(date, new Date());
              const disabled = isDisabled(date);

              return (
                <button
                  key={toIsoDate(date)}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(toIsoDate(date));
                    setOpen(false);
                  }}
                  className={[
                    "h-10 rounded-xl text-sm transition",
                    selected ? "bg-blue-600 text-white" : "hover:bg-zinc-100",
                    today && !selected ? "border border-zinc-300" : "",
                    disabled ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                onChange(toIsoDate(today));
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setOpen(false);
              }}
              className="font-medium text-blue-600 hover:underline"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-medium text-zinc-600 hover:underline"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
