# Supabase Auth email templates (branded)

These are the emails **Supabase Auth** sends (signup confirmation, password reset,
magic link). They are NOT part of the app's `/admin` template system and are NOT
sent through Resend, they're configured in the Supabase Dashboard.

They match the Resend `emailShell` look (blue Aster header, styled button, footer).

## Where to paste

Supabase Dashboard → **Authentication → Emails** (or "Email Templates") → pick the
template, paste the HTML into the **Message body**, and set the **Subject**.

| File | Supabase template | Suggested subject |
|------|-------------------|-------------------|
| `confirm-signup.html` | Confirm signup | `Confirm your email to start using Aster` |
| `reset-password.html` | Reset password | `Reset your Aster password` |
| `magic-link.html` | Magic link | `Your Aster sign-in link` |

The link variable Supabase substitutes is `{{ .ConfirmationURL }}` (already wired
into the button and the fallback link). Other available variables: `{{ .Token }}`,
`{{ .TokenHash }}`, `{{ .SiteURL }}`, `{{ .Email }}`, `{{ .RedirectTo }}`.

## Sender name / deliverability (do this too)

The inbox showed **"From Aste"** and these auth emails don't come from
`notifications@hireaster.com` like the Resend ones. To fix both:

- **Custom SMTP**: Dashboard → Authentication → **SMTP Settings** → enable custom
  SMTP and point it at Resend (host `smtp.resend.com`, port 465, user `resend`,
  password = your `RESEND_API_KEY`). Set **Sender name** = `Aster` and **Sender
  email** = `notifications@hireaster.com`.
- This makes auth emails match the transactional ones and improves deliverability
  (SPF/DKIM/DMARC on hireaster.com must be set up in Resend, which they are for the
  transactional sends).

## Note on the logo

Email clients strip inline SVG and block SVG `<img>`, so the header references a
hosted **PNG** of the Aster mark at `https://hireaster.com/aster-mark.png`
(generated from `public/aster-mark.svg`), the same approach as the Resend
`emailShell`. The alt text falls back to "Aster" if a client blocks images.

The PNG only resolves once the site has been deployed with `public/aster-mark.png`,
so deploy the marketing site before relying on the logo in these emails.
