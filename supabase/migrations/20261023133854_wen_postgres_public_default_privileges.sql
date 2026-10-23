-- Tables created by the postgres migration owner must receive explicit grants
-- from their own migrations instead of inheriting broad browser-role access.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
