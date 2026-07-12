import { describe, expect, it } from "vitest";

import {
  PERMISSION_KEYS,
  resolvePermission,
  sanitizeOverrides,
} from "./permissions";

describe("resolvePermission", () => {
  it("owner sempre tem qualquer permissão", () => {
    for (const key of PERMISSION_KEYS) {
      expect(resolvePermission("owner", {}, key)).toBe(true);
      expect(resolvePermission("owner", { [key]: false }, key)).toBe(true);
    }
  });

  it("assistente sem override cai no default do papel (negado)", () => {
    expect(resolvePermission("assistant", {}, "edit_goals")).toBe(false);
    expect(resolvePermission("assistant", {}, "delete_transactions")).toBe(
      false
    );
  });

  it("override individual concede e retira permissão do assistente", () => {
    expect(
      resolvePermission("assistant", { edit_goals: true }, "edit_goals")
    ).toBe(true);
    expect(
      resolvePermission("assistant", { edit_goals: false }, "edit_goals")
    ).toBe(false);
  });
});

describe("sanitizeOverrides", () => {
  it("mantém apenas chaves conhecidas com valores booleanos", () => {
    expect(
      sanitizeOverrides({
        edit_goals: true,
        edit_categories: false,
        chave_desconhecida: true,
        delete_transactions: "true",
      })
    ).toEqual({ edit_goals: true, edit_categories: false });
  });

  it("entrada inválida vira objeto vazio", () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides("x")).toEqual({});
    expect(sanitizeOverrides(42)).toEqual({});
  });
});
