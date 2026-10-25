import { expect, it } from "vitest";
import { recordAnswer } from "../src/vocab/model";
it("removes wrong answers only after two consecutive correct answers", () => {
  const id = "데모 기본 어휘|01|apple";
  let p = recordAnswer({ favorites: [], wrong: [], streak: {} }, id, false);
  p = recordAnswer(p, id, true);
  expect(p.wrong).toContain(id);
  p = recordAnswer(p, id, false);
  p = recordAnswer(p, id, true);
  expect(p.wrong).toContain(id);
  p = recordAnswer(p, id, true);
  expect(p.wrong).not.toContain(id);
});
