# Fix email confirmation on phones

The default Supabase confirmation email redirects to the project's Site URL, currently localhost:3000. On a phone that address points to the phone, not the Mac running Expo. A redirect failure can happen after Supabase has already confirmed the email: first return to the app and try signing in with the registered email and password.

The app now supports code-based signup confirmation and password recovery on native and web. This requires updating the hosted email templates; source files alone do not change your Supabase project settings.

## Configure hosted templates once

Open https://supabase.com/dashboard/project/owygwrazvoxmurceofaw/auth/templates

1. Under Confirm signup, replace the HTML with `supabase/templates/confirm-signup.html` and save. Suggested subject: `Confirm your Mzansi Table email`.
2. Under Reset password, replace the HTML with `supabase/templates/recovery.html` and save. Suggested subject: `Reset your Mzansi Table password`.

Both templates display `{{ .Token }}` instead of requiring a redirect link. Never replace it with a literal code.

Copy each template from Terminal:

```sh
cd /Users/leonard/expo-go-app
pbcopy < supabase/templates/confirm-signup.html
```

Paste and save Confirm signup. Then copy Reset password:

```sh
pbcopy < supabase/templates/recovery.html
```

## Existing users

Reload the app. Try signing in first. If email confirmation is still required, use Confirm an existing account, enter the registered email, and select Send a new code. After the template update, the new email contains a numeric code to enter in the app. Old emails are not changed. Requesting a new code can invalidate earlier codes; always use the latest email. Provider rate limits still apply.

## Recovery

Choose Send password reset email, enter the emailed recovery code, then choose and repeat a new password. The app verifies recovery through Supabase before allowing the password update.

## URLs for future web deployment

When a public web deployment exists, set its HTTPS URL under Authentication → URL Configuration as Site URL and allow only intended callback URLs. Do not use localhost:3000 as the production address. Code-based flows do not require a browser redirect, but other Auth email flows may still use the Site URL.

## Verification

Test signup on a phone, resend an expired code, reject an incorrect code, confirm the latest code, then sign out and sign back in. Test password recovery with a different code and verify the new password works. No confirmation emails were sent by local validation.

Sources: https://supabase.com/docs/guides/auth/auth-email-templates and https://supabase.com/docs/reference/javascript/auth-verifyotp
