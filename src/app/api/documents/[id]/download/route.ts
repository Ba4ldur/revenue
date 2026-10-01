import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAuthUser } from "@/infrastructure/auth/supabase";
import { resolveOrgContext } from "@/application/context";
import { getDocumentDownloadUrl } from "@/application/documents";
import { AppError } from "@/application/errors";
import { ORG_COOKIE } from "@/lib/session";

/** Redireciona para signed URL (60 s) somente após autenticação, vínculo, papel e RLS. Download auditado. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  const ctx = await resolveOrgContext(user, (await cookies()).get(ORG_COOKIE)?.value ?? null);
  if (!ctx) return NextResponse.json({ error: "sem organização" }, { status: 403 });
  try {
    const url = await getDocumentDownloadUrl(ctx, (await params).id);
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : "erro" }, { status });
  }
}
