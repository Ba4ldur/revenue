"use client";

/** Mesma mensagem para inexistente e sem permissão: não revela se um id existe em outra organização. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft p-4 text-sm text-bad">
      <p className="font-medium">Não foi possível exibir esta página: o registro não existe ou você não tem acesso a ele.</p>
      {error.digest && <p className="mt-1 text-xs">Código para suporte: {error.digest}</p>}
      <button onClick={reset} className="mt-3 rounded border border-bad/40 bg-white px-2 py-1 text-xs">Tentar novamente</button>
    </div>
  );
}
