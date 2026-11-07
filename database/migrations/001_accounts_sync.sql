-- Apply once in the Supabase SQL editor, followed by numbered migrations.
-- Tables are user-scoped. Only the authenticated backend service can mutate them.
begin;
create table public.stepin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_profile_id text, revision bigint not null default 0,
  history_epoch integer not null default 0, sync_consent_at timestamptz
);
create table public.stepin_profiles (
  user_id uuid not null references public.stepin_accounts(user_id) on delete cascade,
  id text not null, body jsonb not null, primary key(user_id,id)
);
create table public.stepin_sessions (
  user_id uuid not null references public.stepin_accounts(user_id) on delete cascade,
  id text not null, body jsonb not null, primary key(user_id,id)
);
create table public.stepin_messages (
  user_id uuid not null, id text not null, session_id text not null, body jsonb not null,
  created_at timestamptz not null default now(), primary key(user_id,id),
  foreign key(user_id,session_id) references public.stepin_sessions(user_id,id) on delete cascade
);
create index stepin_message_order on public.stepin_messages(user_id,session_id,created_at,id);
create table public.stepin_tombstones (
  user_id uuid not null references public.stepin_accounts(user_id) on delete cascade,
  id text not null, deleted_at timestamptz not null default now(), primary key(user_id,id)
);
create table public.stepin_processed_ops (
  user_id uuid not null references public.stepin_accounts(user_id) on delete cascade,
  id text not null, payload_hash text not null, primary key(user_id,id)
);
create table public.stepin_coach_runs (
  user_id uuid not null, id text not null, session_id text not null, profile_id text not null,
  payload_hash text not null, status text not null check(status in ('running','completed','failed')),
  lease_until timestamptz not null, response jsonb,
  primary key(user_id,id), foreign key(user_id,session_id) references public.stepin_sessions(user_id,id) on delete cascade
);
do $$ declare t text; begin
  foreach t in array array['stepin_accounts','stepin_profiles','stepin_sessions','stepin_messages','stepin_tombstones','stepin_processed_ops','stepin_coach_runs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy own_rows on public.%I for select to authenticated using (auth.uid()=user_id)',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.stepin_valid_answers(a jsonb) returns boolean language plpgsql immutable set search_path=public as $$
declare i int; k text; v jsonb; item text; allowed text[]; n int;
begin
  if jsonb_typeof(a)<>'object' or (select count(*) from jsonb_object_keys(a))<>10 then return false; end if;
  for i in 1..6 loop
    v:=a->('q'||i); if v is null or jsonb_typeof(v)<>'number' or v::text !~ '^[1-5]$' then return false; end if;
  end loop;
  if not coalesce(a->>'q7'=any(array['One to one','Small group','Larger group','Structured activity','Observe first','No preference']),false) then return false; end if;
  for i in 8..10 loop
    v:=a->('q'||i); if v is null or jsonb_typeof(v)<>'array' or jsonb_array_length(v)=0 then return false; end if;
    n:=jsonb_array_length(v);
    if n<>(select count(distinct value) from jsonb_array_elements_text(v)) then return false; end if;
    allowed:=case i
      when 8 then array['Short wording','More processing time','Text instead of audio','Audio instead of reading','Language support','Alternative or augmentative communication support','None','Prefer not to say']
      when 9 then array['Quieter setting or sensory breaks','Hearing access','Visual access','Speech or communication access','Mobility or seating access','Attention or memory support','Other self-described support','None','Prefer not to say']
      else array['A low-pressure first step','Icebreakers','Follow-up questions','Encouragement','Help joining an activity','Help taking a break or leaving politely','No coaching right now'] end;
    for item in select jsonb_array_elements_text(v) loop
      if not (item=any(allowed)) or (n>1 and item=any(array['None','Prefer not to say','No coaching right now'])) then return false; end if;
    end loop;
    if i=8 and v ? 'Text instead of audio' and v ? 'Audio instead of reading' then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function public.stepin_snapshot(p_user uuid) returns jsonb language plpgsql set search_path=public as $$
declare a stepin_accounts;
begin
  insert into stepin_accounts(user_id) values(p_user) on conflict do nothing;
  select * into a from stepin_accounts where user_id=p_user for share;
  return jsonb_build_object('revision',a.revision,'historyEpoch',a.history_epoch,'activeProfileId',a.active_profile_id,
    'profiles',coalesce((select jsonb_agg(body order by (body->>'revision')::int) from stepin_profiles where user_id=p_user),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(s.body||jsonb_build_object('messages',coalesce((select jsonb_agg(m.body order by m.created_at,m.id) from stepin_messages m where m.user_id=p_user and m.session_id=s.id),'[]'::jsonb))) from stepin_sessions s where s.user_id=p_user),'[]'::jsonb));
end $$;

create function public.stepin_sync(p_user uuid,p_revision bigint,p_ops jsonb) returns jsonb language plpgsql set search_path=public as $$
declare a stepin_accounts; op jsonb; item jsonb; existing jsonb; op_id text; entity_id text; old_hash text; seq int; duplicate_all boolean:=true; kind text;
begin
  if jsonb_typeof(p_ops)<>'array' or jsonb_array_length(p_ops)>100 then raise exception 'INVALID_BATCH'; end if;
  insert into stepin_accounts(user_id) values(p_user) on conflict do nothing;
  select * into a from stepin_accounts where user_id=p_user for update;
  for op in select jsonb_array_elements(p_ops) loop
    select payload_hash into old_hash from stepin_processed_ops where user_id=p_user and id=op->>'id';
    if old_hash is null then duplicate_all:=false; elsif old_hash<>md5(op::text) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  end loop;
  if duplicate_all and jsonb_array_length(p_ops)>0 then return stepin_snapshot(p_user); end if;
  if a.revision<>p_revision then raise exception 'REVISION_CONFLICT'; end if;
  for op in select jsonb_array_elements(p_ops) loop
    op_id:=op->>'id'; kind:=op->>'kind';
    if exists(select 1 from stepin_processed_ops where user_id=p_user and id=op_id) then continue; end if;
    if kind in ('profile.activate','profile.redact','profile.put') then
      item:=op->'profile'; entity_id:=item->>'id';
      if not stepin_valid_answers(item->'answers') or item->>'completedAt' is null or item->>'questionnaireVersion'<>'1' then raise exception 'INVALID_PROFILE'; end if;
      if kind<>'profile.put' and a.active_profile_id is distinct from op->>'expectedActiveId' then raise exception 'PROFILE_CONFLICT'; end if;
      if kind='profile.redact' then
        update stepin_profiles set body=jsonb_set(jsonb_set(body,'{answers,q8}','["Prefer not to say"]'),'{answers,q9}','["Prefer not to say"]') where user_id=p_user;
        item:=jsonb_set(jsonb_set(item,'{answers,q8}','["Prefer not to say"]'),'{answers,q9}','["Prefer not to say"]');
      end if;
      select body into existing from stepin_profiles where user_id=p_user and id=entity_id;
      if existing is not null then
        if existing->'answers'<>item->'answers' then raise exception 'IMMUTABLE_PROFILE'; end if;
      else
        select coalesce(max((body->>'revision')::int),0)+1 into seq from stepin_profiles where user_id=p_user;
        item:=item||jsonb_build_object('revision',seq,
          'comfortScore',round((((item->'answers'->>'q1')::numeric+(item->'answers'->>'q2')::numeric+(item->'answers'->>'q3')::numeric+(item->'answers'->>'q4')::numeric)/4-1)/4*100),
          'desiredActivityScore',round((((item->'answers'->>'q5')::numeric+(item->'answers'->>'q6')::numeric)/2-1)/4*100));
        insert into stepin_profiles values(p_user,entity_id,item);
      end if;
      if kind<>'profile.put' then a.active_profile_id:=entity_id; end if;
    elsif kind='profile.delete_all' then
      a.active_profile_id:=null; delete from stepin_profiles where user_id=p_user;
    elsif kind='session.put' then
      item:=op->'session'; entity_id:=item->>'id';
      if (op->>'historyEpoch')::int=a.history_epoch and not exists(select 1 from stepin_tombstones where user_id=p_user and id=entity_id) then
        insert into stepin_sessions values(p_user,entity_id,item) on conflict(user_id,id) do update set body=excluded.body;
      end if;
    elsif kind='message.put' then
      item:=op->'message'; entity_id:=op->>'sessionId';
      if item->>'role'='assistant' and item->'audit'->>'source' is distinct from 'fixture' then raise exception 'UNTRUSTED_ASSISTANT'; end if;
      if (op->>'historyEpoch')::int=a.history_epoch and exists(select 1 from stepin_sessions where user_id=p_user and id=entity_id) then
        select body into existing from stepin_messages where user_id=p_user and id=item->>'id';
        if existing is not null and existing<>item then raise exception 'IMMUTABLE_MESSAGE'; end if;
        insert into stepin_messages values(p_user,item->>'id',entity_id,item,(item->>'createdAt')::timestamptz) on conflict do nothing;
      end if;
    elsif kind='session.delete' then
      entity_id:=op->>'sessionId';
      insert into stepin_tombstones(user_id,id) values(p_user,entity_id) on conflict do nothing;
      delete from stepin_sessions where user_id=p_user and id=entity_id;
    elsif kind='session.delete_all' then
      insert into stepin_tombstones(user_id,id) select p_user,id from stepin_sessions where user_id=p_user on conflict do nothing;
      delete from stepin_sessions where user_id=p_user; a.history_epoch:=a.history_epoch+1;
    else raise exception 'INVALID_OPERATION'; end if;
    insert into stepin_processed_ops values(p_user,op_id,md5(op::text));
  end loop;
  update stepin_accounts set active_profile_id=a.active_profile_id,history_epoch=a.history_epoch,revision=revision+1,sync_consent_at=coalesce(sync_consent_at,now()) where user_id=p_user;
  return stepin_snapshot(p_user);
end $$;

create function public.stepin_assert_profile(p_user uuid,p_profile text) returns void language plpgsql set search_path=public as $$
declare a stepin_accounts; p jsonb;
begin
  select * into a from stepin_accounts where user_id=p_user for update;
  if a.active_profile_id is null then raise exception 'SCREENING_REQUIRED'; end if;
  if a.active_profile_id<>p_profile then raise exception 'STALE_PROFILE'; end if;
  select body into p from stepin_profiles where user_id=p_user and id=p_profile;
  if p is null or not stepin_valid_answers(p->'answers') then raise exception 'SCREENING_REQUIRED'; end if;
end $$;

create function public.stepin_reserve_run(p_user uuid,p_request jsonb,p_hash text) returns jsonb language plpgsql set search_path=public as $$
declare r stepin_coach_runs; s jsonb; p jsonb; items jsonb;
begin
  perform stepin_assert_profile(p_user,p_request->>'expectedProfileVersionId');
  select body into s from stepin_sessions where user_id=p_user and id=p_request->>'sessionId';
  if s is null then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from stepin_messages where user_id=p_user and id=p_request->>'messageId' and
    (session_id<>p_request->>'sessionId' or body->>'role'<>'user' or body->>'text'<>p_request->>'message' or coalesce(body->>'action','')<>coalesce(p_request->>'action',''))) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  select * into r from stepin_coach_runs where user_id=p_user and id=p_request->>'requestId';
  if r.id is not null then
    if r.payload_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if r.status='completed' then return jsonb_build_object('cached',r.response); end if;
    if r.status='running' and r.lease_until>now() then raise exception 'REQUEST_IN_PROGRESS'; end if;
  end if;
  insert into stepin_coach_runs values(p_user,p_request->>'requestId',p_request->>'sessionId',p_request->>'expectedProfileVersionId',p_hash,'running',now()+interval '10 minutes',null)
    on conflict(user_id,id) do update set status='running',lease_until=now()+interval '10 minutes';
  select body into p from stepin_profiles where user_id=p_user and id=p_request->>'expectedProfileVersionId';
  select coalesce(jsonb_agg(body order by created_at,id),'[]') into items from (select body,created_at,id from stepin_messages where user_id=p_user and session_id=p_request->>'sessionId' order by created_at desc,id desc limit 12) m;
  return jsonb_build_object('profile',p,'session',s||jsonb_build_object('messages',items));
end $$;

create function public.stepin_finish_run(p_user uuid,p_request jsonb,p_hash text,p_response jsonb) returns void language plpgsql set search_path=public as $$
declare r stepin_coach_runs; user_message jsonb; assistant_message jsonb;
begin
  perform stepin_assert_profile(p_user,p_request->>'expectedProfileVersionId');
  select * into r from stepin_coach_runs where user_id=p_user and id=p_request->>'requestId' for update;
  if r.id is null or r.payload_hash<>p_hash or r.status<>'running' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  if not exists(select 1 from stepin_sessions where user_id=p_user and id=r.session_id) then raise exception 'DELETED'; end if;
  if exists(select 1 from stepin_messages where user_id=p_user and id=p_request->>'messageId' and
    (session_id<>r.session_id or body->>'role'<>'user' or body->>'text'<>p_request->>'message' or coalesce(body->>'action','')<>coalesce(p_request->>'action',''))) then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  user_message:=jsonb_build_object('id',p_request->>'messageId','role','user','text',p_request->>'message','action',p_request->>'action','createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'persisted',true,'requestId',r.id);
  assistant_message:=p_response->'message';
  if assistant_message->'audit'->>'source'<>'live' or assistant_message->'audit'->>'decision' not in ('approved','clarification') then raise exception 'AUDIT_REQUIRED'; end if;
  insert into stepin_messages values(p_user,user_message->>'id',r.session_id,user_message,now()) on conflict do nothing;
  insert into stepin_messages values(p_user,assistant_message->>'id',r.session_id,assistant_message,now()) on conflict do nothing;
  update stepin_coach_runs set status='completed',response=p_response where user_id=p_user and id=r.id;
  update stepin_sessions set body=jsonb_set(body,'{updatedAt}',to_jsonb(assistant_message->>'createdAt')) where user_id=p_user and id=r.session_id;
  update stepin_accounts set revision=revision+1 where user_id=p_user;
end $$;
create function public.stepin_fail_run(p_user uuid,p_request_id text) returns void language sql set search_path=public as $$
  update stepin_coach_runs set status='failed',response=null where user_id=p_user and id=p_request_id and status='running';
$$;
-- All mutation and snapshot RPCs are backend-only. Never put the service key in Expo.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'stepin_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',r.fn);
    execute format('grant execute on function %s to service_role',r.fn);
  end loop;
end $$;
commit;
