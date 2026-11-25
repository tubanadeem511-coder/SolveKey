export const reportCategories = [
  { value: "street_light", label: "Street Light" },
  { value: "electricity_issue", label: "Electricity Issue" },
  { value: "water_leakage", label: "Water Leakage" },
  { value: "water_supply", label: "Water Supply" },
  { value: "sewerage_drainage", label: "Sewerage / Drainage" },
  { value: "pothole", label: "Pothole" },
  { value: "broken_road", label: "Broken Road" },
  { value: "damaged_footpath", label: "Damaged Footpath" },
  { value: "garbage", label: "Garbage" },
  { value: "overflowing_dustbin", label: "Overflowing Dustbin" },
  { value: "waste_collection", label: "Waste Collection" },
  { value: "dirty_street", label: "Dirty Street" },
] as const;

const categoryLabels = new Map<string, string>(
  reportCategories.map(({ value, label }) => [value, label]),
);

export function reportCategoryLabel(category: string | null): string {
  if (!category) return "Unclassified";
  return categoryLabels.get(category) ?? category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
