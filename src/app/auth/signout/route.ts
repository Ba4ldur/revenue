import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/infrastructure/auth/supabase";

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  res.cookies.delete("ri_org");
  return res;
}
