import { expect, test, type Page } from "@playwright/test";
import { CANONICAL_CONTRACT_PAGES, makeTextPdf } from "../support/pdf";
import { makeCnpj } from "../support/cnpj";

/**
 * E2E do cenário canônico pela interface (SUCCESS_CRITERIA): Next em produção + Supabase local real
 * (Auth, Storage, Postgres com RLS). Extração com dublê determinístico (sem credencial de IA no ambiente).
 */
const stamp = Date.now();
const cnpj = makeCnpj(stamp % 89_999_999);
const password = "SenhaForte123";

async function signUp(page: Page, email: string, name: string, org: string) {
  await page.goto("/login?mode=signup");
  await page.getByLabel("Nome completo").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Razão social").fill(org);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await page.waitForURL("**/dashboard");
}

async function clickAll(page: Page, name: string, expected: number) {
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(expected);
  for (let i = 0; i < 10; i++) {
    const buttons = page.getByRole("button", { name, exact: true });
    const n = await buttons.count();
    if (n === 0) return;
    await buttons.first().click();
    await expect(buttons).toHaveCount(n - 1);
  }
}

test("contrato → regras → imports → cálculo → divergência auditável → classificação; isolamento entre organizações", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signUp(page, `admin-${stamp}@acme.test`, "Ana Admin", "Acme Serviços Técnicos Ltda.");

  // Cliente
  await page.goto("/customers");
  await page.getByLabel("Razão social").fill("Indústria ABC S.A.");
  await page.getByLabel("CNPJ").fill(cnpj);
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await expect(page.getByText("Cliente cadastrado.")).toBeVisible();

  // Contrato + versão 1
  await page.goto("/contracts");
  await page.getByLabel("Cliente").selectOption({ label: "Indústria ABC S.A." });
  await page.getByLabel("Número do contrato").fill(`00921-${stamp}`);
  await page.getByLabel("Título").fill("Suporte e manutenção técnica");
  await page.getByLabel("Início da vigência").fill("2026-01-01");
  await page.getByRole("button", { name: "Criar contrato" }).click();
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/);
  const contractUrl = page.url();

  // PDF privado
  await page.locator('input[name="file"]').setInputFiles({ name: "Contrato.pdf", mimeType: "application/pdf", buffer: Buffer.from(makeTextPdf(CANONICAL_CONTRACT_PAGES)) });
  await page.getByRole("button", { name: "Enviar PDF" }).click();
  await expect(page.getByText("Documento armazenado com texto extraído por página.")).toBeVisible();

  // Extração (IA) → revisão → ativação
  await page.getByRole("link", { name: /^Regras/ }).click();
  await page.getByRole("button", { name: "Extrair regras" }).click();
  await expect(page.getByText("3 regra(s) proposta(s) para revisão.")).toBeVisible();
  await expect(page.getByText("Trecho verificado no documento")).toHaveCount(3);
  await clickAll(page, "Confirmar como está", 3);
  await clickAll(page, "Ativar", 3);
  await expect(page.getByText("Ativas (3)")).toBeVisible();

  // Import operacional
  await page.goto("/imports");
  await page.getByLabel("Tipo").selectOption("OPERATIONAL");
  await page.locator('input[name="file"]').setInputFiles({ name: "horas-set-2026.csv", mimeType: "text/csv", buffer: Buffer.from(`CNPJ;Cliente;Competência;Horas;Descrição\n${cnpj};Indústria ABC;09/2026;30;Chamados\n${cnpj};Indústria ABC;09/2026;27;Visitas técnicas\n`) });
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Pré-visualizar 20 linhas" }).click();
  await expect(page.getByText(/"competence":"2026-09-01"/).first()).toBeVisible();
  await page.getByRole("button", { name: "Processar importação" }).click();
  await expect(page.getByText(/Processamento concluído: \d+ linha\(s\) importada/)).toBeVisible();

  // Import de faturamento
  await page.goto("/imports");
  await page.getByLabel("Tipo").selectOption("BILLING");
  await page.locator('input[name="file"]').setInputFiles({ name: "nfs-set-2026.csv", mimeType: "text/csv", buffer: Buffer.from(`CNPJ;Cliente;Competência;Valor;Emissão;NF\n${cnpj};Indústria ABC;09/2026;18.000,00;05/10/2026;${stamp % 100000}\n`) });
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Processar importação" }).click();
  await expect(page.getByText(/Processamento concluído: \d+ linha\(s\) importada/)).toBeVisible();

  // Cálculo da competência
  await page.goto(contractUrl);
  await page.getByLabel("Competência (MM/AAAA)").fill("09/2026");
  await page.getByRole("button", { name: "Calcular competência" }).click();
  await expect(page.getByText(/Esperado R\$ 22\.760,00, diferença R\$ 4\.760,00 — divergência aberta para revisão/)).toBeVisible();

  // Divergência com evidências
  await page.getByRole("link", { name: /ver divergência/ }).click();
  await page.waitForURL(/\/findings\/[0-9a-f-]{36}$/);
  const findingUrl = page.url();
  await expect(page.getByRole("heading", { name: "Consumo excedente não faturado" })).toBeVisible();
  await expect(page.getByText(/^Possível receita não faturada: R\$ 4\.760,00\./)).toBeVisible();
  await expect(page.getByRole("cell", { name: "max(0, 57 − 40) = 17; 17 × 280.00 = 4760.00" })).toBeVisible();
  await expect(page.getByText(/Página 2: “incluídas 40 horas mensais”/)).toBeVisible();
  await expect(page.getByText("expected_revenue_engine@1.0.0")).toBeVisible();

  // Classificação humana
  await page.getByRole("button", { name: "Iniciar revisão" }).click();
  await expect(page.getByText("Iniciar revisão registrado por você. Status atual: Em revisão.")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar divergência" }).click();
  await expect(page.getByText("Confirmar divergência registrado por você. Status atual: Confirmado.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Em revisão → Confirmado" })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/screens/finding.png", fullPage: true });

  // Auditoria e painel
  await page.goto("/settings/audit?entity=findings");
  await expect(page.getByText("finding.confirm").first()).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("1 confirmada(s) por revisão humana")).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: "test-results/screens/dashboard.png", fullPage: true });
    await page.goto(contractUrl);
    await page.screenshot({ path: "test-results/screens/contract.png", fullPage: true });
    await page.goto(contractUrl + "/rules");
    await page.screenshot({ path: "test-results/screens/rules.png", fullPage: true });
  }

  // TESTE 5 pela interface: outra organização não acessa a divergência nem o documento
  const other = await browser.newContext();
  const pageB = await other.newPage();
  await signUp(pageB, `admin-b-${stamp}@outra.test`, "Bruno", "Outra Empresa Ltda.");
  await pageB.goto(findingUrl);
  await expect(pageB.getByText(/o registro não existe ou você não tem acesso/)).toBeVisible();
  await pageB.goto(contractUrl);
  await expect(pageB.getByText(/o registro não existe ou você não tem acesso/)).toBeVisible();
  await pageB.goto("/findings");
  await expect(pageB.getByText("Nenhuma divergência para os filtros")).toBeVisible();
  await other.close();
});
