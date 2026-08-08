-- The pixel dimensions of the _inline derivative.
--
-- `code-standards.md` requires explicit width and height on every next/image —
-- the optimizer is off, so nothing else can infer them, and without them a
-- thread of images reflows as each one loads. Nothing in the schema recorded an
-- image's size, because until F29 nothing rendered one.
--
-- CLIENT-REPORTED, and this is the one deliberate exemption from F28's rule
-- that a row records what was measured rather than what was claimed. The
-- browser decoded the image to produce the derivative, so it is the only party
-- that knows the result cheaply; the server would have to decode the file again
-- on the request path, which is the exact work the derivative pipeline exists to
-- avoid. The exemption is safe because these two numbers are cosmetic: a wrong
-- value costs a layout wobble, where a wrong size_bytes or mime_type would be a
-- security claim. Nothing may start trusting them for anything else.
--
-- Null for a PDF, for an image whose browser could not derive one, and for every
-- row written before this migration. The renderer falls back to an intrinsic
-- layout when they are absent, which is the pre-F29 behaviour.

alter table public.attachments
  add column inline_width  integer,
  add column inline_height integer;

comment on column public.attachments.inline_width is
  'Client-reported pixel width of the _inline derivative, for next/image sizing only. Cosmetic: never trust it for a security or accounting decision. (F29)';
