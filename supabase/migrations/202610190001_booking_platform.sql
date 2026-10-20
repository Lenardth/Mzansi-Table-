begin;
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 name text not null check (length(trim(name)) between 1 and 100),
 role text not null check (role in ('client','owner'))
);
create table public.listings (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles,
 kind text not null check (kind in ('restaurant','event','experience')),
 title text not null check (length(trim(title)) between 1 and 150),
 description text not null default '' check (length(description) <= 3000),
 location text not null check (length(trim(location)) between 1 and 300),
 starts_at timestamptz,
 capacity integer not null check (capacity between 1 and 10000),
 created_at timestamptz not null default now(),
 check (kind <> 'event' or starts_at is not null)
);
create table public.bookings (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.listings,
 client_id uuid not null references public.profiles,
 starts_at timestamptz not null,
 guests integer not null check (guests between 1 and 10000),
 note text not null default '' check (length(note) <= 1000),
 status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now()
);
create index bookings_listing_slot on public.bookings(listing_id, starts_at);
create index bookings_client on public.bookings(client_id);
create index listings_owner on public.listings(owner_id);

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,name,role) values(new.id,
 coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),'Member'),
 case when new.raw_user_meta_data->>'role' = 'owner' then 'owner' else 'client' end);
 return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.bookings enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy listings_read on public.listings for select to authenticated using (true);
create policy listings_create on public.listings for insert to authenticated with check (
 owner_id = (select auth.uid()) and (kind = 'event' or exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'owner'))
 and (starts_at is null or starts_at > now())
);
create policy bookings_read on public.bookings for select to authenticated using (
 client_id = (select auth.uid()) or exists(select 1 from public.listings where id = listing_id and owner_id = (select auth.uid()))
);
-- Writes go through RPCs so status transitions, ownership, and capacity are checked together.
revoke all on public.profiles, public.listings, public.bookings from anon, authenticated;
grant select on public.profiles, public.listings, public.bookings to authenticated;
grant insert on public.listings to authenticated;

create function public.request_booking(p_listing uuid, p_starts timestamptz, p_guests integer, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare item public.listings; booking_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into item from public.listings where id = p_listing for update;
 if not found then raise exception 'Listing not found'; end if;
 if item.owner_id = auth.uid() then raise exception 'You cannot book your own listing'; end if;
 if not exists(select 1 from public.profiles where id = auth.uid() and role = 'client') then raise exception 'A client account is required to book'; end if;
 if p_starts is null or p_starts <= now() or p_guests is null or p_guests < 1 or p_guests > item.capacity then raise exception 'Choose a future time and valid guest count'; end if;
 if item.starts_at is not null and p_starts <> item.starts_at then raise exception 'Choose the scheduled event time'; end if;
 if exists(select 1 from public.bookings where listing_id = p_listing and client_id = auth.uid() and starts_at = p_starts and status in ('pending','accepted')) then raise exception 'You already have a request for this time'; end if;
 insert into public.bookings(listing_id,client_id,starts_at,guests,note) values(p_listing,auth.uid(),p_starts,p_guests,coalesce(p_note,'')) returning id into booking_id;
 return booking_id;
end;
$$;
create function public.respond_booking(p_booking uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare reservation public.bookings; item public.listings; occupied integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select l.* into item from public.listings l join public.bookings b on b.listing_id = l.id where b.id = p_booking for update of l;
 if not found then raise exception 'Booking not found'; end if;
 select * into reservation from public.bookings where id = p_booking for update;
 if p_status = 'cancelled' then
   if reservation.client_id <> auth.uid() or reservation.status not in ('pending','accepted') then raise exception 'Cannot cancel this booking'; end if;
 elsif p_status in ('accepted','declined') then
   if item.owner_id <> auth.uid() or reservation.status <> 'pending' then raise exception 'Only the host can respond to a pending booking'; end if;
 else raise exception 'Invalid status'; end if;
 if reservation.starts_at <= now() and p_status <> 'declined' then raise exception 'This booking time has passed'; end if;
 if p_status = 'accepted' then
   select coalesce(sum(guests),0) into occupied from public.bookings where listing_id = item.id and starts_at = reservation.starts_at and status = 'accepted';
   if occupied + reservation.guests > item.capacity then raise exception 'Not enough capacity at this time'; end if;
 end if;
 update public.bookings set status = p_status where id = p_booking;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.request_booking(uuid,timestamptz,integer,text) from public, anon;
revoke all on function public.respond_booking(uuid,text) from public, anon;
grant execute on function public.request_booking(uuid,timestamptz,integer,text), public.respond_booking(uuid,text) to authenticated;
commit;
