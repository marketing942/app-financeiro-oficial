import { expect, test } from "@playwright/test";

// Fase 13 — varredura de segurança e acesso executável sem Supabase real:
// toda rota privada bloqueia visitante; APIs sensíveis negam sem sessão.

const PROTECTED_ROUTES = [
  "/",
  "/receitas",
  "/despesas",
  "/investimentos",
  "/financiamentos",
  "/dividas",
  "/patrimonio",
  "/planejamento",
  "/projetos",
  "/nylo",
  "/relatorios",
  "/contas",
  "/categorias",
  "/membros",
  "/configuracoes",
];

for (const route of PROTECTED_ROUTES) {
  test(`visitante em ${route} é redirecionado ao login`, async ({ page }) => {
    await page.goto(route);
    await page.waitForURL("**/login**");
  });
}

test("API da Nylo nega requisição sem sessão", async ({ request }) => {
  const response = await request.post("/api/nylo", {
    data: { message: "olá" },
  });
  // 401 sem sessão; 503 se a chave OpenAI não estiver configurada —
  // ambos sem vazar dados.
  expect([401, 503]).toContain(response.status());
  const body = await response.json();
  expect(body.error).toBeTruthy();
});

test("exportação CSV nega requisição sem sessão", async ({ request }) => {
  const response = await request.get(
    "/api/relatorios/csv?de=2026-01&ate=2026-01&tipo=categorias"
  );
  expect(response.status()).toBe(401);
});

test("endpoints de cron exigem o segredo", async ({ request }) => {
  for (const path of ["/api/cron/daily", "/api/cron/monthly"]) {
    const noAuth = await request.get(path);
    expect(noAuth.status()).toBe(401);
    const wrongAuth = await request.get(path, {
      headers: { Authorization: "Bearer segredo-errado" },
    });
    expect(wrongAuth.status()).toBe(401);
  }
});
