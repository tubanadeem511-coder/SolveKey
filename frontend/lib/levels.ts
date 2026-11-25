export const LEVELS = [
  { name: "Citizen", minimum: 0 },
  { name: "Guardian", minimum: 50 },
  { name: "Champion", minimum: 200 },
  { name: "Hero", minimum: 500 },
] as const;

export type CitizenLevel = (typeof LEVELS)[number]["name"];

export interface LevelProgress {
  level: CitizenLevel;
  nextLevel: CitizenLevel | null;
  pointsToNext: number;
  progressPercent: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number | null;
}

export function getLevelProgress(points: number): LevelProgress {
  const total = Math.max(0, points);
  let currentIndex = 0;
  for (let index = 1; index < LEVELS.length; index += 1) {
    if (total >= LEVELS[index].minimum) currentIndex = index;
    else break;
  }

  const currentLevel = LEVELS[currentIndex];
  const nextLevel = LEVELS[currentIndex + 1];
  if (!nextLevel) {
    return {
      level: currentLevel.name,
      nextLevel: null,
      pointsToNext: 0,
      progressPercent: 100,
      pointsIntoLevel: total - currentLevel.minimum,
      pointsForNextLevel: null,
    };
  }

  const pointsIntoLevel = total - currentLevel.minimum;
  const pointsForNextLevel = nextLevel.minimum - currentLevel.minimum;
  return {
    level: currentLevel.name,
    nextLevel: nextLevel.name,
    pointsToNext: nextLevel.minimum - total,
    progressPercent: Math.min(100, (pointsIntoLevel / pointsForNextLevel) * 100),
    pointsIntoLevel,
    pointsForNextLevel,
  };
}

export function levelRank(level: string): number {
  return LEVELS.findIndex((entry) => entry.name === level);
}
