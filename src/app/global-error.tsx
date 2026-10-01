"use client";

/** Falha no layout raiz: mensagem genérica (detalhes técnicos ficam só no log do servidor). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 18 }}>Não foi possível carregar a aplicação.</h1>
        {error.digest && <p style={{ fontSize: 12, color: "#64748b" }}>Código para suporte: {error.digest}</p>}
        <button onClick={reset} style={{ marginTop: 12 }}>Tentar novamente</button>
      </body>
    </html>
  );
}
