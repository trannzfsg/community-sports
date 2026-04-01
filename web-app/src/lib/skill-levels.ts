export const SKILL_LEVEL_OPTIONS = [
  "Beginner",
  "Lower Intermediate",
  "Intermediate",
  "Upper Intermediate",
  "Advanced",
  "Open / Tournament",
] as const;

export type SkillLevel = (typeof SKILL_LEVEL_OPTIONS)[number];
