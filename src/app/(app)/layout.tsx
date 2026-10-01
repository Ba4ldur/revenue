import { requireOrg } from "@/lib/session";
import { can, listMemberships, ROLE_LABELS } from "@/application/context";
import { Nav } from "./nav";
import { switchOrg } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const memberships = await listMemberships(ctx.userId);
  const hidden = can(ctx, "imports.read") ? [] : ["/imports"];
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-ink px-3 py-4 text-white">
        <div className="px-3 pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-200">Revenue Intelligence</p>
          {memberships.length > 1 ? (
            <form action={switchOrg} className="mt-2">
              <select name="orgId" defaultValue={ctx.orgId} aria-label="Organização"
                className="w-full rounded bg-white/10 px-2 py-1 text-sm text-white">
                {memberships.map((m) => <option key={m.orgId} value={m.orgId} className="text-ink">{m.orgName}</option>)}
              </select>
              <button className="mt-1 text-xs text-slate-300 underline">Trocar</button>
            </form>
          ) : (
            <p className="mt-2 truncate text-sm font-medium">{ctx.orgName}</p>
          )}
          <p className="mt-1 text-xs text-slate-400">{ROLE_LABELS[ctx.role]}</p>
        </div>
        <Nav hidden={hidden} />
        <div className="mt-auto px-3 pt-4 text-xs text-slate-400">
          <p className="truncate">{ctx.email}</p>
          <form action="/auth/signout" method="post"><button className="mt-1 underline hover:text-white">Sair</button></form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
