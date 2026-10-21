/** "When?" choices on the search card. Values travel in the /search query string. */
export const WHEN_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "this-week", label: "This week" },
  { value: "weekend", label: "This weekend" },
  { value: "next-week", label: "Next week" },
] as const;

export type WhenValue = (typeof WHEN_OPTIONS)[number]["value"];

export const WHEN_VALUES = WHEN_OPTIONS.map((option) => option.value) as [WhenValue, ...WhenValue[]];

export const ADDRESS_MAX_LENGTH = 200;

export function whenLabel(value: WhenValue): string {
  return WHEN_OPTIONS.find((option) => option.value === value)?.label ?? "Any time";
}
