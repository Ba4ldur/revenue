import { sha256Hex } from "@/domain/hashing";
import { invalid } from "./errors";

/**
 * Validação de arquivo enviado: extensão, MIME declarado, assinatura binária (magic bytes),
 * tamanho e hash. O nome original só é guardado como metadado (nunca compõe o path).
 */
export interface UploadedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface ValidatedFile {
  fileName: string;
  extension: "pdf" | "csv" | "xlsx";
  mimeType: string;
  size: number;
  sha256: string;
  bytes: Uint8Array;
}

const KINDS = {
  pdf: { mimes: ["application/pdf"], max: 20 * 1024 * 1024, canonical: "application/pdf" },
  csv: { mimes: ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv"], max: 10 * 1024 * 1024, canonical: "text/csv" },
  xlsx: { mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], max: 10 * 1024 * 1024, canonical: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
} as const;

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "arquivo";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return (clean || "arquivo").slice(0, 200);
}

export function validateUpload(file: UploadedFile, allowed: Array<keyof typeof KINDS>): ValidatedFile {
  const fileName = sanitizeFileName(file.name);
  const ext = fileName.toLowerCase().split(".").pop() as keyof typeof KINDS | undefined;
  if (!ext || !allowed.includes(ext)) throw invalid(`Extensão não permitida. Aceitos: ${allowed.map((a) => "." + a).join(", ")}`);
  const kind = KINDS[ext];
  if (file.bytes.length === 0) throw invalid("Arquivo vazio");
  if (file.bytes.length > kind.max) throw invalid(`Arquivo excede ${kind.max / 1024 / 1024} MB`);
  if (file.type && !(kind.mimes as readonly string[]).includes(file.type)) throw invalid(`Tipo de arquivo (${file.type}) não corresponde à extensão .${ext}`);
  if (ext === "pdf" && !startsWith(file.bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw invalid("Conteúdo não é um PDF válido");
  if (ext === "xlsx" && !startsWith(file.bytes, [0x50, 0x4b, 0x03, 0x04])) throw invalid("Conteúdo não é um XLSX válido");
  if (ext === "csv") {
    const head = file.bytes.subarray(0, 4096);
    if (head.includes(0)) throw invalid("CSV contém bytes binários");
  }
  return { fileName, extension: ext, mimeType: kind.canonical, size: file.bytes.length, sha256: sha256Hex(file.bytes), bytes: file.bytes };
}
