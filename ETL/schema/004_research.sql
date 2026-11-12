SET search_path TO hackathon_research, public;

CREATE VIEW v_deadlines_next_7_days AS
SELECT
    e.event_id,
    e.event_name,
    m.milestone_type,
    m.milestone_name,
    m.due_at,
    m.timezone_name,
    e.registration_link,
    e.official_website
FROM event_milestones AS m
JOIN events AS e
    ON e.event_id = m.event_id
WHERE m.due_at IS NOT NULL
  AND m.due_at >= NOW()
  AND m.due_at < NOW() + INTERVAL '7 days'
ORDER BY m.due_at;

CREATE VIEW v_deadlines_next_30_days AS
SELECT
    e.event_id,
    e.event_name,
    m.milestone_type,
    m.milestone_name,
    m.due_at,
    m.timezone_name,
    e.registration_link,
    e.official_website
FROM event_milestones AS m
JOIN events AS e
    ON e.event_id = m.event_id
WHERE m.due_at IS NOT NULL
  AND m.due_at >= NOW()
  AND m.due_at < NOW() + INTERVAL '30 days'
ORDER BY m.due_at;

CREATE VIEW v_source_evidence_appendix AS
SELECT
    e.event_id,
    e.event_name,
    s.source_type,
    s.source_title,
    s.source_url,
    s.is_primary_source,
    s.verified_on,
    s.notes
FROM event_sources AS s
JOIN events AS e
    ON e.event_id = s.event_id
ORDER BY e.event_name, s.verified_on DESC;
