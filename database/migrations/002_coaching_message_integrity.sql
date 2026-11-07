-- Safe to apply after 001, including an earlier copy of 001.
begin;
create or replace function public.stepin_reserve_run(p_user uuid,p_request jsonb,p_hash text) returns jsonb language plpgsql set search_path=public as $$
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

create or replace function public.stepin_finish_run(p_user uuid,p_request jsonb,p_hash text,p_response jsonb) returns void language plpgsql set search_path=public as $$
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

commit;
