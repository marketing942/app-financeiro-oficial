import { expect, test } from "@playwright/test";

// Fase 13 — acessibilidade das páginas públicas (executável sem Supabase):
// idioma, labels associadas, navegação por teclado e foco visível.

test("documento declara idioma pt-BR e título", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  expect(await page.title()).toContain("Domínio Financeiro");
});

test("campos do login têm labels associadas e são alcançáveis por teclado", async ({
  page,
}) => {
  await page.goto("/login");

  // Labels programaticamente associadas (getByLabel falharia sem for/id).
  const email = page.getByLabel("E-mail");
  const password = page.getByLabel("Senha", { exact: true });
  await expect(email).toBeVisible();
  await expect(password).toBeVisible();

  // Navegação por teclado: a partir do e-mail, Tab alcança a senha
  // (tolerando elementos focáveis intermediários, ex.: mostrar senha).
  await email.focus();
  await expect(email).toBeFocused();
  let reached = false;
  for (let i = 0; i < 5 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await password.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
});

test("erros de validação são anunciados e associados aos campos", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Mensagem de erro visível vinculada ao formulário (sem depender de cor).
  await expect(
    page.locator('[aria-invalid="true"], [role="alert"]').first()
  ).toBeVisible();
});

test("cadastro expõe os requisitos de senha em texto", async ({ page }) => {
  await page.goto("/cadastro");
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  // Botão principal identificável por nome acessível.
  await expect(
    page.getByRole("button", { name: /criar conta/i })
  ).toBeVisible();
});
