-- ============================================================================
-- 0109: Aster Sign — native e-signature audit trail on offers
-- ============================================================================
-- We now sign offers ourselves (no DocuSign): the candidate opens /offer/<token>,
-- reviews the branded letter, signs (typed or drawn) and consents. The aster-sign
-- edge function records the audit trail below, builds a signed PDF with a
-- certificate of completion, stores it in the private 'offer-letters' bucket, and
-- flips the offer to accepted. esign_provider becomes 'aster'.
--
-- A simple electronic signature with this audit trail (signer identity by email
-- link possession, timestamp, IP, user agent, explicit consent, and a SHA-256
-- document hash for tamper-evidence) is enforceable for employment offers under
-- the Malaysia Electronic Commerce Act 2006, US ESIGN/UETA and EU eIDAS (SES).

-- The HR note / letter opening, persisted so the public signing page and the
-- signed PDF render the same letter (DocuSign built it transiently; we can't).
alter table public.offers add column if not exists message           text;

-- Signature + audit trail, filled in when the candidate signs.
alter table public.offers add column if not exists signed_name       text;    -- what the signer typed / their full name
alter table public.offers add column if not exists signature_type    text;    -- 'typed' | 'drawn'
alter table public.offers add column if not exists signed_ip         text;
alter table public.offers add column if not exists signed_user_agent text;
alter table public.offers add column if not exists signed_at         timestamptz;
alter table public.offers add column if not exists viewed_at         timestamptz;  -- first time the letter was opened
alter table public.offers add column if not exists doc_hash          text;    -- SHA-256 of the signed letter text

-- offer_preview already returns the terms + esign_provider/esign_status (0104),
-- which is all the public signing page needs to render, so no function change.
