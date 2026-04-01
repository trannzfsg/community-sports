export const DAY_OF_WEEK_OPTIONS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const SPORT_OPTIONS = ["Badminton", "Basketball"] as const;

export type DayOfWeek = (typeof DAY_OF_WEEK_OPTIONS)[number];
export type TypeOfSport = (typeof SPORT_OPTIONS)[number];

const DAY_TO_INDEX: Record<DayOfWeek, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 0,
};

function formatDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNextGameOn(dayOfWeek: DayOfWeek, from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const currentDayIndex = start.getDay();
  const targetDayIndex = DAY_TO_INDEX[dayOfWeek];

  let daysAhead = (targetDayIndex - currentDayIndex + 7) % 7;
  if (daysAhead < 0) {
    daysAhead += 7;
  }

  start.setDate(start.getDate() + daysAhead);
  return formatDateLocal(start);
}
