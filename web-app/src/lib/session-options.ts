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

function parseTimeParts(time: string) {
  const [hoursText = "0", minutesText = "0"] = time.split(":");
  return {
    hours: Number(hoursText),
    minutes: Number(minutesText),
  };
}

function parseLocalDate(dateText: string) {
  const [yearText = "0", monthText = "1", dayText = "1"] = dateText.split("-");
  return new Date(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function addDays(dateText: string, days: number) {
  const date = parseLocalDate(dateText);
  date.setDate(date.getDate() + days);
  return formatDateLocal(date);
}

function getSessionStartDateTime(dateText: string, startAt: string) {
  const sessionDate = parseLocalDate(dateText);
  const { hours, minutes } = parseTimeParts(startAt);
  sessionDate.setHours(hours, minutes, 0, 0);
  return sessionDate;
}

export function getSuggestedNextGameOn(
  dayOfWeek: DayOfWeek,
  startAt: string,
  from = new Date(),
) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const currentDayIndex = start.getDay();
  const targetDayIndex = DAY_TO_INDEX[dayOfWeek];
  const { hours, minutes } = parseTimeParts(startAt);

  let daysAhead = (targetDayIndex - currentDayIndex + 7) % 7;
  const currentMinutes = from.getHours() * 60 + from.getMinutes();
  const sessionMinutes = hours * 60 + minutes;

  if (daysAhead === 0 && currentMinutes >= sessionMinutes) {
    daysAhead = 7;
  }

  start.setDate(start.getDate() + daysAhead);
  return formatDateLocal(start);
}

export function getEffectiveNextGameOn(
  dayOfWeek: DayOfWeek,
  startAt: string,
  nextGameOn?: string,
  from = new Date(),
) {
  const suggested = getSuggestedNextGameOn(dayOfWeek, startAt, from);

  if (!nextGameOn) {
    return suggested;
  }

  const candidateStart = getSessionStartDateTime(nextGameOn, startAt);

  if (from.getTime() < candidateStart.getTime()) {
    return nextGameOn;
  }

  const nextSuggested = addDays(suggested, 7);

  if (nextSuggested < nextGameOn) {
    return nextGameOn;
  }

  return nextSuggested;
}
