-- SB Product Brain — expand supplier document types and ensure one price table per source document.
alter table public.source_documents
  drop constraint if exists source_documents_document_type_check;

alter table public.source_documents
  add constraint source_documents_document_type_check
  check (document_type = any (array[
    'price_table'::text,
    'catalog'::text,
    'technical_sheet'::text,
    'finish_catalog'::text,
    'commercial_terms'::text,
    'promotion'::text,
    'other'::text
  ]));

create unique index if not exists price_tables_source_document_unique_idx
  on public.price_tables(source_document_id)
  where source_document_id is not null;
