-- Allow the server-side HackScout API role to read only the listing tables.
-- Add hackathon_research to the project's exposed schemas in Supabase API settings.
GRANT USAGE ON SCHEMA hackathon_research TO service_role;

GRANT SELECT ON TABLE
    hackathon_research.events,
    hackathon_research.event_tracks,
    hackathon_research.event_benefits,
    hackathon_research.event_sources,
    hackathon_research.application_requirements
TO service_role;
