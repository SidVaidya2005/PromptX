-- The two bucket limits feature 03 deliberately left null.
--
-- These are not a second opinion on the checks /api/attachments already makes.
-- Uploads go client-direct to Storage through a signed URL, so the Node process
-- is never in the byte path — validating mime and size when the URL is ISSUED
-- constrains nothing about what actually lands afterwards. The bucket is the
-- only thing standing between a signed URL and a 400 MB file.
--
-- Both figures are duplicated from src/lib/constants.ts, which is where the
-- application reads them: MAX_ATTACHMENT_BYTES and ALLOWED_ATTACHMENT_MIME_TYPES.
-- SQL cannot import TypeScript, so this is the one place they could drift, and a
-- test asserts the bucket row matches the constants rather than trusting that
-- whoever changes one remembers the other.
--
-- image/webp is on the list twice over: it is an accepted original format, and
-- it is what the browser's _thumb and _inline derivatives are encoded as. A list
-- that covered only originals would refuse every derivative of a PNG.

update storage.buckets
   set file_size_limit    = 10485760, -- MAX_ATTACHMENT_BYTES, 10 MiB
       allowed_mime_types = array[
         'image/png',
         'image/jpeg',
         'image/webp',
         'image/gif',
         'application/pdf'
       ]
 where id = 'attachments';
