-- Supabase SQL Editorで実行。既存データは削除しません。
-- 1ユーザーにつき1つの在庫ノート。認証された本人だけが読み書きできます。
begin;
create table if not exists public.stock_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  mutation_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint stock_notes_payload_object check (jsonb_typeof(payload) = 'object')
);
alter table public.stock_notes enable row level security;
revoke all on public.stock_notes from anon, authenticated;
grant select, insert, update on public.stock_notes to authenticated;
drop policy if exists stock_notes_select_own on public.stock_notes;
create policy stock_notes_select_own on public.stock_notes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists stock_notes_insert_own on public.stock_notes;
create policy stock_notes_insert_own on public.stock_notes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists stock_notes_update_own on public.stock_notes;
create policy stock_notes_update_own on public.stock_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 期待する版番号と一致した場合だけ更新します。同時更新は競合として通知。
-- mutation_idで応答が途切れた後の同じ保存リクエストの再試行も安全にします。
create or replace function public.save_stock_note(p_payload jsonb, p_expected_revision bigint, p_mutation_id uuid)
returns setof public.stock_notes
language plpgsql security invoker set search_path = '' as $$
declare saved public.stock_notes;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_mutation_id is null
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'version' is distinct from '1'
    or jsonb_typeof(p_payload->'products') is distinct from 'array'
    or jsonb_typeof(p_payload->'orders') is distinct from 'array'
    or jsonb_typeof(p_payload->'history') is distinct from 'array'
    or jsonb_typeof(p_payload->'brands') is distinct from 'array'
    or jsonb_typeof(p_payload->'tags') is distinct from 'array'
    or octet_length(p_payload::text) > 5000000
  then raise exception 'INVALID_PAYLOAD' using errcode = '22023'; end if;
  -- 同一ユーザーの初回作成も含め、トランザクション内で直列化します。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  select * into saved from public.stock_notes where user_id = auth.uid() for update;
  if found then
    if saved.mutation_id = p_mutation_id then return next saved; return; end if;
    if saved.revision <> p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
    update public.stock_notes set payload = p_payload, revision = revision + 1,
      mutation_id = p_mutation_id, updated_at = now()
      where user_id = auth.uid() returning * into saved;
  else
    if p_expected_revision <> 0 then raise exception 'REVISION_CONFLICT' using errcode = '40001'; end if;
    insert into public.stock_notes(user_id, payload, revision, mutation_id)
      values (auth.uid(), p_payload, 1, p_mutation_id) returning * into saved;
  end if;
  return next saved;
end;
$$;
revoke all on function public.save_stock_note(jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_stock_note(jsonb,bigint,uuid) to authenticated;
commit;
