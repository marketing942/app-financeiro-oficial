import { describe, expect, it } from "vitest";

import { goalHorizon } from "./goals";

describe("goalHorizon", () => {
  it("deriva o marco do total de meses — sem duplicar metas", () => {
    expect(goalHorizon(1)).toBe("monthly");
    expect(goalHorizon(12)).toBe("annual");
    expect(goalHorizon(60)).toBe("5y");
    expect(goalHorizon(120)).toBe("10y");
    expect(goalHorizon(180)).toBe("15y");
  });

  it("qualquer outro prazo é personalizado", () => {
    expect(goalHorizon(2)).toBe("custom");
    expect(goalHorizon(24)).toBe("custom");
    expect(goalHorizon(61)).toBe("custom");
    expect(goalHorizon(240)).toBe("custom");
  });
});
