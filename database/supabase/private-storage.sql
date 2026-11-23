-- MANUAL SUPABASE SETUP ONLY. Review against the chosen project before execution.
-- No ordinary JWT may directly access the dedicated app bucket, even if another
-- permissive policy exists. Service credentials remain trusted and bypass RLS.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('team-documents','team-documents',false,20971520,ARRAY['text/plain','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=20971520,
  allowed_mime_types=ARRAY['text/plain','application/pdf'];
DROP POLICY IF EXISTS assistant_no_direct_objects ON storage.objects;
CREATE POLICY assistant_no_direct_objects ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING(bucket_id <> 'team-documents') WITH CHECK(bucket_id <> 'team-documents');
