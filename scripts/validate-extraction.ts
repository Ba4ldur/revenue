/**
 * Validação do provedor real de extração com um PDF real, SEM gravar no banco.
 *
 *   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run validate:extraction -- caminho/contrato.pdf
 *
 * Mostra: texto por página extraído (contagem), propostas validadas, itens descartados e se o
 * trecho citado foi localizado literalmente na página (mesma regra do banco).
 * Atenção (LGPD/sigilo): o texto do contrato é enviado ao provedor configurado.
 */
import { readFileSync, existsSync } from "node:fs";

const envPath = new URL("../.env.local", import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}
const pdfPath = process.argv[2];
if (!pdfPath || !existsSync(pdfPath)) {
  console.error("Uso: npm run validate:extraction -- <arquivo.pdf>");
  process.exit(2);
}
const { extractPdfPages } = await import("../src/application/documents");
const { getExtractionProvider } = await import("../src/ai/factory");
const { validateExtraction, excerptFoundOnPage, EXTRACTION_PROMPT } = await import("../src/ai/contract-extraction");

const bytes = new Uint8Array(readFileSync(pdfPath));
if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
  console.error("Arquivo não é PDF");
  process.exit(2);
}
const { pages, error } = await extractPdfPages(bytes);
if (error) {
  console.error(`Falha ao extrair texto: ${error}`);
  process.exit(1);
}
const withText = pages.filter((p) => p.trim().length > 0).length;
console.log(`Páginas: ${pages.length} · com texto: ${withText} · caracteres: ${pages.reduce((a, p) => a + p.length, 0)}`);
if (withText === 0) {
  console.error("PDF sem texto extraível (provavelmente escaneado). OCR está fora do MVP; cadastre regras manualmente.");
  process.exit(1);
}
const provider = getExtractionProvider();
if (!provider) {
  console.error("AI_PROVIDER não configurado. Defina AI_PROVIDER=anthropic e ANTHROPIC_API_KEY.");
  process.exit(2);
}
console.log(`Provedor: ${provider.name} · modelo: ${provider.model} · prompt: ${EXTRACTION_PROMPT.name}@${EXTRACTION_PROMPT.version}`);
const started = Date.now();
const docPages = pages.map((text, i) => ({ pageNumber: i + 1, text }));
const response = await provider.extract(docPages);
const { proposals, discarded } = validateExtraction(response.output, pages.length);
console.log(`Modelo servido: ${response.servedModel} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`\nPropostas válidas: ${proposals.length}`);
for (const p of proposals) {
  const found = excerptFoundOnPage(p.sourceText, pages[p.sourcePage - 1] ?? "");
  console.log(`- ${p.ruleType} · valor=${p.numericValue ?? p.textValue} ${p.unit ?? ""} · p.${p.sourcePage} · confiança=${p.extractionConfidence} · trecho ${found ? "LOCALIZADO" : "NÃO LOCALIZADO (confirmação será bloqueada)"}`);
  console.log(`    “${p.sourceText.slice(0, 200)}”`);
}
console.log(`\nDescartadas na validação: ${discarded.length}`);
for (const d of discarded) console.log(`- ${d.reason}: ${JSON.stringify(d.raw).slice(0, 200)}`);
console.log("\nNada foi gravado. Valores devem ser conferidos por humano contra o contrato antes de qualquer confirmação.");
