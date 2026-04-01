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
