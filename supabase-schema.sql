-- Run this once in the Supabase SQL Editor.
-- Never put a service_role or secret key in this browser app.
-- Use only a publishable/anon client key with RLS enabled.

create extension if not exists pgcrypto;

create table if not exists public.survey_measurements (
  id uuid primary key default gen_random_uuid(),
  session_code text not null default 'default',
  client_id text not null,
  client_measurement_id bigint,
  start_lat double precision not null,
  start_lng double precision not null,
  end_lat double precision not null,
  end_lng double precision not null,
  gps_distance_m numeric(12, 2) not null check (gps_distance_m >= 0),
  actual_distance_m numeric(12, 2) not null check (actual_distance_m > 0),
  absolute_error_m numeric(12, 2) not null check (absolute_error_m >= 0),
  relative_error_percent numeric(12, 2) not null check (relative_error_percent >= 0),
  environment text not null,
  environment_key text not null,
  gps_accuracy_m numeric(12, 2),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists survey_measurements_session_recorded_idx
  on public.survey_measurements (session_code, recorded_at desc);

alter table public.survey_measurements enable row level security;

revoke all on table public.survey_measurements from anon, authenticated;
grant select, insert on table public.survey_measurements to anon, authenticated;
grant select, insert, update, delete on table public.survey_measurements to service_role;

drop policy if exists "survey_measurements_select_public" on public.survey_measurements;
create policy "survey_measurements_select_public"
  on public.survey_measurements
  for select
  to anon, authenticated
  using (true);

drop policy if exists "survey_measurements_insert_public" on public.survey_measurements;
create policy "survey_measurements_insert_public"
  on public.survey_measurements
  for insert
  to anon, authenticated
  with check (
    session_code <> ''
    and client_id <> ''
    and actual_distance_m > 0
    and gps_distance_m >= 0
    and absolute_error_m >= 0
    and relative_error_percent >= 0
  );
