-- =============================================================================
-- Storage privado (ADR-023) e registro inicial de motores (ADR-007).
-- =============================================================================

-- Buckets privados. Nenhuma política em storage.objects para anon/authenticated:
-- acesso somente via servidor (service_role) após autorização + signed URL curta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('contract-documents', 'contract-documents', false, 20971520, array['application/pdf']),
  ('imports', 'imports', false, 10485760,
   array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Versões de motores e prompts. Dados de referência (não são seed de demonstração).
insert into app.engine_registry (engine_name, engine_version, description, change_summary, calculation_breaking_change)
values
  ('expected_revenue_engine', '1.0.0',
   'Receita esperada por contrato e competência: mensalidade fixa, franquia por unidade, excedente, desconto fixo.',
   'Versão inicial. ROUND_HALF_UP escala 2 por componente; versão contratual deve cobrir o mês inteiro.', true),
  ('reconciliation_engine', '1.0.0',
   'Expected vs Billed por contrato e competência, materialidade e classificação do tipo de finding.',
   'Versão inicial. Tipos: CONSUMO_EXCEDENTE_NAO_FATURADO, COBRANCA_ABAIXO_DO_CONTRATO, CLIENTE_ATIVO_SEM_FATURAMENTO.', true),
  ('entity_resolution_engine', '1.0.0',
   'Resolução de clientes: CNPJ, external_id, vínculo confirmado, razão social, nome fantasia, fuzzy.',
   'Versão inicial. Somente CNPJ e external_id exatos casam automaticamente.', false),
  ('import_normalization_engine', '1.0.0',
   'Normalização de linhas CSV/XLSX: números BR/US, datas DD/MM/AAAA, competência, CNPJ.',
   'Versão inicial.', true),
  ('contract_rule_extraction_prompt', '1.0.0',
   'Prompt de extração de regras contratuais com proveniência (página e trecho literal).',
   'Versão inicial.', false)
on conflict do nothing;
