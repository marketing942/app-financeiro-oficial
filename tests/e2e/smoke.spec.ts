import { expect, test } from "@playwright/test";

// Testes de fumaça: rodam sem Supabase real (variáveis dummy).
// Fluxos completos de autenticação são cobertos na Fase 13 contra
// Supabase local/staging.

test("página de login renderiza o formulário", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page
      .getByRole("heading", { name: "Entrar" })
      .or(page.getByText("Entrar").first())
  ).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("página de cadastro renderiza o formulário", async ({ page }) => {
  await page.goto("/cadastro");
  await expect(page.getByLabel("Nome completo")).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirmar senha")).toBeVisible();
});

test("página de recuperação de senha renderiza", async ({ page }) => {
  await page.goto("/recuperar-senha");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar link" })).toBeVisible();
});

test("rota autenticada redireciona visitante para /login", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL("**/login**");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("rota interna protegida também redireciona", async ({ page }) => {
  await page.goto("/despesas");
  await page.waitForURL("**/login**");
});
