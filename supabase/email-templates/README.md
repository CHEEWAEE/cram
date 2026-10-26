# Email templates

Cram-branded versions of the Supabase Auth emails. They live in the Supabase
dashboard, not in code, so changes here have to be pasted in by hand:

Authentication → Emails → Templates

| Template in Supabase | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your Cram account |
| Reset password | `reset-password.html` | Reset your Cram password |

`{{ .ConfirmationURL }}` is filled in by Supabase. Leave it as is.

The sender name and address come from the SMTP settings (Authentication →
Emails → SMTP Settings), not from these templates.
