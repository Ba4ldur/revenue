/**
 * Gera PDFs de texto simples (Helvetica, WinAnsiEncoding) para testes e seed.
 * Cada elemento de `pages` é uma lista de linhas.
 */
function escapePdfText(s: string): Buffer {
  const latin1 = Buffer.from(s, "latin1");
  const out: number[] = [];
  for (const b of latin1) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return Buffer.from(out);
}

export function makeTextPdf(pages: string[][]): Uint8Array {
  const objects: Buffer[] = [];
  const add = (b: Buffer) => objects.push(b) && objects.length;
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  objects.push(Buffer.alloc(0), Buffer.alloc(0)); // reservados (1, 2)
  add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  const pageIds: number[] = [];
  for (const lines of pages) {
    const parts: Buffer[] = [Buffer.from("BT /F1 11 Tf 14 TL 50 790 Td\n")];
    for (const line of lines) parts.push(Buffer.from("("), escapePdfText(line), Buffer.from(") Tj T*\n"));
    parts.push(Buffer.from("ET"));
    const stream = Buffer.concat(parts);
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]));
    const pageId = add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let pos = chunks[0]!.length;
  objects.forEach((body, i) => {
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.push(pos);
    chunks.push(obj);
    pos += obj.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(xref), Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(chunks));
}

export const CANONICAL_CONTRACT_PAGES: string[][] = [
  [
    "CONTRATO DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS Nº 00921",
    "CONTRATANTE: Indústria ABC S.A.",
    "CONTRATADA: Acme Serviços Técnicos Ltda.",
    "CLÁUSULA 1 - DO OBJETO",
    "Prestação de serviços de suporte e manutenção técnica.",
  ],
  [
    "CLÁUSULA 4 - DO PREÇO",
    "O CONTRATANTE pagará mensalidade fixa de R$ 18.000,00 (dezoito mil reais).",
    "Estão incluídas 40 horas mensais de suporte técnico.",
    "Cada hora adicional será faturada a R$ 280,00 (duzentos e oitenta reais).",
  ],
];
