export interface Word {
  id: string;
  group: string;
  day: string;
  en: string;
  ko: string;
  pos: string;
}
// Original-authored sample contents. Never imported from customer VOCAB_DATA.
const rows = [
  ["01", "apple", "사과", "명사"],
  ["01", "river", "강", "명사"],
  ["01", "quiet", "조용한", "형용사"],
  ["01", "share", "나누다", "동사"],
  ["02", "garden", "정원", "명사"],
  ["02", "build", "짓다", "동사"],
  ["02", "careful", "조심스러운", "형용사"],
  ["02", "quickly", "빠르게", "부사"],
];
export const WORDS: Word[] = rows.map(([day, en, ko, pos]) => ({
  id: `데모 기본 어휘|${day}|${en}`,
  group: "데모 기본 어휘",
  day,
  en,
  ko,
  pos,
}));
export type Progress = {
  favorites: string[];
  wrong: string[];
  streak: Record<string, number>;
};
export const KEY = "tutor-ax.vocab-demo.v1";
export function loadProgress(): Progress {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    const known = new Set(WORDS.map((w) => w.id));
    const clean = (values: unknown) =>
      Array.isArray(values)
        ? [
            ...new Set(
              values.filter(
                (id: unknown): id is string =>
                  typeof id === "string" && known.has(id),
              ),
            ),
          ]
        : [];
    const streak: Record<string, number> = {};
    for (const id of known) {
      if (data?.streak?.[id] === 1) streak[id] = 1;
    }
    return {
      favorites: clean(data?.favorites),
      wrong: clean(data?.wrong),
      streak,
    };
  } catch {
    return { favorites: [], wrong: [], streak: {} };
  }
}
export function recordAnswer(
  progress: Progress,
  id: string,
  correct: boolean,
): Progress {
  const next = { ...progress, streak: { ...progress.streak } };
  if (!correct) {
    next.wrong = [...new Set([...progress.wrong, id])];
    next.streak[id] = 0;
  } else if (progress.wrong.includes(id)) {
    next.streak[id] = (progress.streak[id] || 0) + 1;
    if (next.streak[id] >= 2) {
      next.wrong = progress.wrong.filter((w) => w !== id);
      delete next.streak[id];
    }
  }
  return next;
}
