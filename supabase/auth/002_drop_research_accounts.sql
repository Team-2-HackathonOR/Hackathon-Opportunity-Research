-- Run only after jwt-service is using AUTH_DATABASE_URL and a login, invite, verify, and logout have succeeded.
-- Drops the account tables from the research schema. Event tables stay.

drop table if exists hackathon_research.invitations;
drop table if exists hackathon_research.app_users;
