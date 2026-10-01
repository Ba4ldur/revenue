import { RULE_TYPES, RULE_TYPE_LABELS, RULE_UNITS, UNIT_LABELS } from "@/domain/contracts/rules";
import { Field, inputCls } from "@/components/ui";
import { dec, formatQuantity } from "@/domain/money/decimal";

export function RuleFields({ d }: { d?: { ruleType?: string; numericValue?: string | null; unit?: string | null; validFrom?: string; validUntil?: string | null; sourcePage?: number | null; sourceText?: string; textValue?: string | null } }) {
  const value = d?.numericValue ? formatQuantity(d.ruleType === "DISCOUNT_PERCENTAGE" ? dec(d.numericValue).times(100) : d.numericValue) : "";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Tipo">
        <select name="ruleType" defaultValue={d?.ruleType ?? "FIXED_MONTHLY_FEE"} className={inputCls}>
          {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Valor" hint="Formato brasileiro (18.000,00). Percentual em pontos (10 = 10%)."><input name="value" defaultValue={value} className={inputCls} /></Field>
      <Field label="Unidade">
        <select name="unit" defaultValue={d?.unit ?? ""} className={inputCls}>
          <option value="">—</option>
          {RULE_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
        </select>
      </Field>
      <Field label="Vigência inicial"><input name="validFrom" type="date" required defaultValue={d?.validFrom} className={inputCls} /></Field>
      <Field label="Vigência final (opcional)"><input name="validUntil" type="date" defaultValue={d?.validUntil ?? ""} className={inputCls} /></Field>
      <Field label="Página"><input name="sourcePage" type="number" min={1} defaultValue={d?.sourcePage ?? ""} className={inputCls} /></Field>
      <div className="sm:col-span-3">
        <Field label="Trecho literal do documento" hint="Precisa existir no texto da página; é verificado pelo banco antes da confirmação.">
          <textarea name="sourceText" required rows={2} defaultValue={d?.sourceText} className={inputCls} />
        </Field>
      </div>
      <div className="sm:col-span-3">
        <Field label="Texto (regras informativas)"><input name="textValue" defaultValue={d?.textValue ?? ""} className={inputCls} /></Field>
      </div>
    </div>
  );
}
