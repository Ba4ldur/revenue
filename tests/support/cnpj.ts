/** CNPJs válidos (DV) gerados deterministicamente para testes. */
export function makeCnpj(seed: number): string {
  const base = String(10000000 + (seed % 89999999)).padStart(8, "0") + "0001";
  const digits = base.split("").map(Number);
  const dv = (ds: number[], weights: number[]) => {
    const s = ds.reduce((acc, d, i) => acc + d * weights[i]!, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base + String(d1) + String(d2);
}

