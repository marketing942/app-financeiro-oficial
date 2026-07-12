-- Extensions and internal helper schema.
-- The `app` schema holds authorization helpers used by RLS policies;
-- it is never exposed through the API.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
grant usage on schema app to authenticated, anon;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
