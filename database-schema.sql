-- ============================================================
-- ECO NOTES HUB — DATABASE SCHEMA
-- Run this once in Supabase: Dashboard → SQL Editor → New query
-- ============================================================

-- Extends Supabase's built-in auth.users with a role (student/admin)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  created_at timestamptz default now()
);

-- Students submit one of these when they want access
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

-- Uploaded notes / past papers / revision materials
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  course text not null,
  year text not null,
  category text not null,
  file_path text not null,       -- path inside the 'materials' storage bucket
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — this is what actually enforces the rules
-- ============================================================

alter table public.profiles enable row level security;
alter table public.access_requests enable row level security;
alter table public.materials enable row level security;

-- PROFILES: a user can see their own profile; admins can see everyone's
create policy "view own profile" on public.profiles
  for select using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ACCESS REQUESTS: anyone (even logged-out visitors) can submit a request
create policy "anyone can request access" on public.access_requests
  for insert with check (true);

-- ACCESS REQUESTS: only admins can view or update the request list
create policy "admin can view requests" on public.access_requests
  for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin can update requests" on public.access_requests
  for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- MATERIALS: any logged-in (approved) user can view the list
create policy "logged in users can view materials" on public.materials
  for select using (auth.role() = 'authenticated');

-- MATERIALS: only admins can add or remove materials
create policy "admin can manage materials" on public.materials
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin can delete materials" on public.materials
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- STORAGE BUCKET for uploaded files (run the bucket creation
-- from the Supabase Dashboard → Storage → New bucket → name it
-- "materials", set it to Private — then run the policies below)
-- ============================================================

create policy "authenticated users can read materials files"
  on storage.objects for select
  using (bucket_id = 'materials' and auth.role() = 'authenticated');

create policy "admin can upload materials files"
  on storage.objects for insert
  with check (
    bucket_id = 'materials'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "admin can delete materials files"
  on storage.objects for delete
  using (
    bucket_id = 'materials'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- AFTER running this file, turn YOUR friend into the admin:
-- 1. Have him sign up once through the site's normal login flow
--    (or create the user manually in Dashboard → Authentication)
-- 2. Then run this, with his real email:
--
--    update public.profiles set role = 'admin' where email = 'his-email@example.com';
--
-- Every other signup created via the approval flow defaults to 'student'.
-- ============================================================