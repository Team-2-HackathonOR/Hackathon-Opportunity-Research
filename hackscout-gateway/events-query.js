const eventsQuery = `
  query HackScoutEvents($after: Cursor) {
    eventsCollection(first: 30, after: $after) {
      edges {
        node {
          event_id
          event_name
          organizer_name
          official_website
          registration_link
          rules_faq_link
          city
          state_region
          country
          venue
          format
          event_start_date
          event_end_date
          registration_deadline_at
          registration_status
          last_verified_at
          student_eligibility
          outside_school_eligibility
          international_student_wording
          age_rules
          geographic_restrictions
          invitation_requirements
          team_size_min
          team_size_max
          solo_participation_policy
          team_formation_rules
          all_members_must_register
          registration_fee_amount
          registration_fee_currency
          registration_fee_notes
          travel_support
          lodging_support
          meals_support
          reimbursement_conditions
          ai_tool_policy
          pre_existing_code_policy
          intellectual_property_terms
          application_requirements
          operational_status
          evidence_confidence
          event_tracksCollection(first: 50) {
            edges {
              node {
                track_name
                description
              }
            }
          }
          event_benefitsCollection(first: 50) {
            edges {
              node {
                benefit_type
                title
                description
                award_value
              }
            }
          }
          event_sourcesCollection(first: 50) {
            edges {
              node {
                source_url
                source_title
              }
            }
          }
          application_requirementsCollection(first: 50) {
            edges {
              node {
                requirement_text
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

module.exports = eventsQuery;
