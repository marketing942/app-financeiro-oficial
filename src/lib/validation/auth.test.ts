import { describe, expect, it } from "vitest";

import {
  loginSchema,
  recoverPasswordSchema,
  resetPasswordSchema,
  signUpSchema,
} from "./auth";

describe("loginSchema", () => {
  it("aceita credenciais válidas", () => {
    const result = loginSchema.safeParse({
      email: "usuario@exemplo.com",
      password: "qualquer-senha",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita e-mail inválido", () => {
    const result = loginSchema.safeParse({
      email: "nao-e-email",
      password: "senha",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita senha vazia", () => {
    const result = loginSchema.safeParse({
      email: "usuario@exemplo.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("normaliza espaços do e-mail", () => {
    const result = loginSchema.safeParse({
      email: "  usuario@exemplo.com  ",
      password: "senha",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("usuario@exemplo.com");
    }
  });
});

describe("signUpSchema", () => {
  const valid = {
    fullName: "Maria Silva",
    email: "maria@exemplo.com",
    password: "senha-segura-123",
    confirmPassword: "senha-segura-123",
  };

  it("aceita cadastro válido", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejeita senha com menos de 8 caracteres", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      password: "curta12",
      confirmPassword: "curta12",
    });
    expect(result.success).toBe(false);
  });

  it("aceita senha com exatamente 8 caracteres (limite)", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      password: "12345678",
      confirmPassword: "12345678",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita senhas que não coincidem", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      confirmPassword: "outra-senha-123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("confirmPassword");
    }
  });

  it("rejeita nome muito curto", () => {
    const result = signUpSchema.safeParse({ ...valid, fullName: "A" });
    expect(result.success).toBe(false);
  });
});

describe("recoverPasswordSchema", () => {
  it("aceita e-mail válido", () => {
    expect(recoverPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(
      true
    );
  });

  it("rejeita e-mail vazio", () => {
    expect(recoverPasswordSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("aceita nova senha válida e confirmada", () => {
    const result = resetPasswordSchema.safeParse({
      password: "nova-senha-123",
      confirmPassword: "nova-senha-123",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita confirmação divergente", () => {
    const result = resetPasswordSchema.safeParse({
      password: "nova-senha-123",
      confirmPassword: "diferente-123",
    });
    expect(result.success).toBe(false);
  });
});
