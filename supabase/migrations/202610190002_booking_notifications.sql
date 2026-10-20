begin;
alter table public.bookings add column host_feedback text not null default '' check (length(host_feedback) <= 1000);
alter table public.bookings add column responded_at timestamptz;
alter table public.bookings add column client_name text not null default '';
update public.bookings b set client_name = p.name from public.profiles p where p.id = b.client_id;

create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles,
 booking_id uuid not null references public.bookings,
 title text not null,
 body text not null,
 read_at timestamptz,
 created_at timestamptz not null default now()
);
create index notifications_user on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.push_devices (
 token text primary key check (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'),
 user_id uuid not null references public.profiles,
 updated_at timestamptz not null default now()
);
create index push_devices_user on public.push_devices(user_id);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
create function public.register_push_device(p_token text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 insert into public.push_devices(token,user_id) values(p_token,auth.uid())
 on conflict(token) do update set user_id = auth.uid(), updated_at = now();
end;
$$;
create function public.unregister_push_device(p_token text) returns void language plpgsql security definer set search_path = '' as $$
begin
 delete from public.push_devices where token = p_token and user_id = auth.uid();
end;
$$;

-- The delivery queue is never readable or writable using a public app key.
create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications,
 channel text not null check (channel in ('email','push')),
 push_token text,
 status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_id uuid,
 leased_at timestamptz,
 provider_id text,
 last_error text,
 sent_at timestamptz,
 receipt_status text check (receipt_status in ('ok','error','unavailable')),
 receipt_checked_at timestamptz
);
create index deliveries_pending on public.notification_deliveries(available_at) where status in ('pending','sending');
create index deliveries_receipts on public.notification_deliveries(sent_at) where channel = 'push' and status = 'sent' and receipt_checked_at is null;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant select, update on public.notification_deliveries to service_role;
grant select on public.notifications, public.profiles to service_role;
grant select, delete on public.push_devices to service_role;

create function public.queue_notification(p_user uuid, p_booking uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare notification uuid;
begin
 insert into public.notifications(user_id,booking_id,title,body) values(p_user,p_booking,p_title,p_body) returning id into notification;
 insert into public.notification_deliveries(notification_id,channel) values(notification,'email');
 insert into public.notification_deliveries(notification_id,channel,push_token)
 select notification,'push',token from public.push_devices where user_id = p_user;
end;
$$;
create function public.booking_notifications() returns trigger language plpgsql security definer set search_path = '' as $$
declare item public.listings; details text; feedback text;
begin
 select * into item from public.listings where id = new.listing_id;
 details := item.title || ' | ' || to_char(new.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI') || ' UTC | ' || new.guests || ' guests | Reference ' || left(new.id::text,8);
 if TG_OP = 'INSERT' then
   perform public.queue_notification(item.owner_id,new.id,'New booking request',new.client_name || ' requested ' || details || case when new.note <> '' then E'\nClient note: ' || new.note else '' end);
   perform public.queue_notification(new.client_id,new.id,'Booking request received','Awaiting host approval: ' || details);
 elsif old.status <> new.status then
   feedback := case when new.host_feedback <> '' then E'\nHost feedback: ' || new.host_feedback else '' end;
   if new.status = 'accepted' then
     perform public.queue_notification(new.client_id,new.id,'Booking approved','Your booking is confirmed: ' || details || feedback);
   elsif new.status = 'declined' then
     perform public.queue_notification(new.client_id,new.id,'Booking rejected','Your booking was rejected: ' || details || feedback);
   elsif new.status = 'cancelled' then
     perform public.queue_notification(item.owner_id,new.id,'Booking cancelled',new.client_name || ' cancelled: ' || details);
     perform public.queue_notification(new.client_id,new.id,'Cancellation confirmed','Your booking was cancelled: ' || details);
   end if;
 end if;
 return new;
end;
$$;
create function public.set_booking_client_name() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 select name into new.client_name from public.profiles where id = new.client_id;
 return new;
end;
$$;
create trigger booking_client_name before insert on public.bookings for each row execute function public.set_booking_client_name();
create trigger booking_notifications after insert or update of status on public.bookings for each row execute function public.booking_notifications();

drop function public.respond_booking(uuid,text);
create function public.respond_booking(p_booking uuid, p_status text, p_feedback text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare reservation public.bookings; item public.listings; occupied integer;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if length(coalesce(p_feedback,'')) > 1000 then raise exception 'Feedback must be 1,000 characters or fewer'; end if;
 select l.* into item from public.listings l join public.bookings b on b.listing_id = l.id where b.id = p_booking for update of l;
 if not found then raise exception 'Booking not found'; end if;
 select * into reservation from public.bookings where id = p_booking for update;
 if p_status = 'cancelled' then
   if reservation.client_id <> auth.uid() or reservation.status not in ('pending','accepted') then raise exception 'Cannot cancel this booking'; end if;
 elsif p_status in ('accepted','declined') then
   if item.owner_id <> auth.uid() or reservation.status <> 'pending' then raise exception 'Only the listing host can respond to a pending booking'; end if;
   if p_status = 'declined' and length(trim(coalesce(p_feedback,''))) = 0 then raise exception 'Give the client a reason for rejection'; end if;
 else raise exception 'Invalid status'; end if;
 if reservation.starts_at <= now() then raise exception 'This booking time has passed'; end if;
 if p_status = 'accepted' then
   select coalesce(sum(guests),0) into occupied from public.bookings where listing_id = item.id and starts_at = reservation.starts_at and status = 'accepted';
   if occupied + reservation.guests > item.capacity then raise exception 'Not enough capacity at this time'; end if;
 end if;
 update public.bookings set status = p_status,
 host_feedback = case when p_status = 'cancelled' then host_feedback else trim(coalesce(p_feedback,'')) end,
 responded_at = now() where id = p_booking;
end;
$$;

create function public.claim_notification_deliveries(p_limit integer default 20)
returns setof public.notification_deliveries language sql security definer set search_path = '' as $$
 update public.notification_deliveries set status = 'failed', last_error = 'Delivery retry limit reached'
 where attempts >= 6 and (status = 'pending' or (status = 'sending' and leased_at < now() - interval '5 minutes'));
 update public.notification_deliveries d set status = 'sending', attempts = d.attempts + 1, lease_id = gen_random_uuid(), leased_at = now()
 where d.id in (select id from public.notification_deliveries
 where attempts < 6 and ((status = 'pending' and available_at <= now()) or (status = 'sending' and leased_at < now() - interval '5 minutes'))
 order by available_at for update skip locked limit greatest(1,least(p_limit,50))) returning d.*;
$$;
revoke all on function public.queue_notification(uuid,uuid,text,text), public.booking_notifications(), public.set_booking_client_name(), public.claim_notification_deliveries(integer), public.respond_booking(uuid,text,text), public.register_push_device(text), public.unregister_push_device(text) from public, anon, authenticated;
grant execute on function public.respond_booking(uuid,text,text), public.register_push_device(text), public.unregister_push_device(text) to authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;
commit;
