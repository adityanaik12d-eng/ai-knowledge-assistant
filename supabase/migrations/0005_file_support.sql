-- File-support metadata on documents (origins for PDF / image / Office uploads)
-- so the client can preview the original files.
alter table public.documents add column if not exists file_path text;
alter table public.documents add column if not exists file_mime text;
alter table public.documents add column if not exists file_size bigint;
alter table public.documents add column if not exists file_name text;
alter table public.documents add column if not exists file_kind text;

-- document_stats view extended with file metadata (recursive-safe: plain aggregate view)
create or replace view public.document_stats as
select
  title,
  coalesce(uploaded_by::text, '') as uploaded_by,
  count(*) as "chunkCount",
  sum(length(content)) as "totalChars",
  min(created_at) as "firstUploaded",
  bool_or(file_path is not null) as "isFile",
  max(file_name) as "fileName",
  max(file_mime) as "fileMime",
  max(file_path) as "filePath",
  max(file_kind) as "fileKind"
from public.documents
group by title, uploaded_by;

grant select on public.document_stats to authenticated, service_role;