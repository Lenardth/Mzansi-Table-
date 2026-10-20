begin;
-- Accounts created before the profile trigger was installed still need a profile.
-- Existing profiles (including their roles) are preserved.
insert into public.profiles(id, name, role)
select id,
 left(coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), nullif(split_part(email, '@', 1), ''), 'Member'), 100),
 case when raw_user_meta_data->>'role' = 'owner' then 'owner' else 'client' end
from auth.users
on conflict (id) do nothing;
notify pgrst, 'reload schema';
commit;
