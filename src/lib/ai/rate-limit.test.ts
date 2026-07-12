import { describe, expect, it } from "vitest";

import { checkRateLimit, NYLO_USER_DAILY_LIMIT } from "./rate-limit";

describe("checkRateLimit", () => {
  it("bloqueia no teto diário do usuário (igualdade já bloqueia o próximo)", () => {
    expect(
      checkRateLimit({
        userMessagesToday: NYLO_USER_DAILY_LIMIT - 1,
        workspaceMessagesMonth: 0,
        monthlyLimit: null,
      }).allowed
    ).toBe(true);
    expect(
      checkRateLimit({
        userMessagesToday: NYLO_USER_DAILY_LIMIT,
        workspaceMessagesMonth: 0,
        monthlyLimit: null,
      }).allowed
    ).toBe(false);
  });

  it("bloqueia no teto mensal do workspace quando configurado", () => {
    expect(
      checkRateLimit({
        userMessagesToday: 0,
        workspaceMessagesMonth: 500,
        monthlyLimit: 500,
      }).allowed
    ).toBe(false);
    expect(
      checkRateLimit({
        userMessagesToday: 0,
        workspaceMessagesMonth: 499,
        monthlyLimit: 500,
      }).allowed
    ).toBe(true);
  });

  it("sem limite mensal configurado, só o teto diário vale", () => {
    expect(
      checkRateLimit({
        userMessagesToday: 10,
        workspaceMessagesMonth: 99999,
        monthlyLimit: null,
      }).allowed
    ).toBe(true);
  });
});
