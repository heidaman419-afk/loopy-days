insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ld-files', 'ld-files', false, 26214400, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "ld own files read" on storage.objects;
drop policy if exists "ld own files add" on storage.objects;
drop policy if exists "ld own files change" on storage.objects;
drop policy if exists "ld own files remove" on storage.objects;
create policy "ld own files read" on storage.objects for select to authenticated
  using (bucket_id = 'ld-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ld own files add" on storage.objects for insert to authenticated
  with check (bucket_id = 'ld-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ld own files change" on storage.objects for update to authenticated
  using (bucket_id = 'ld-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ld own files remove" on storage.objects for delete to authenticated
  using (bucket_id = 'ld-files' and (storage.foldername(name))[1] = auth.uid()::text);
