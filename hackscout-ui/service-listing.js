function mapServiceListing(row) {
  const tracks = row.tracks || [];
  const benefits = row.benefits || [];
  const requirements = row.requirements || [];
  const sources = row.sources || [];
  const awards = benefits.filter(({ benefit_type }) => ["prize", "sponsor_prize"].includes(benefit_type));
  const otherBenefits = benefits.filter(({ benefit_type }) => !["prize", "sponsor_prize"].includes(benefit_type));
  const statusLabels = {
    verified_apply_now: "Verified - Apply Now",
    verified_registration_upcoming: "Verified - Registration Upcoming",
    monitor: "Monitor",
    needs_confirmation: "Needs Confirmation",
    not_eligible: "Not Eligible",
    closed_expired: "Closed/Expired",
    rejected_unreliable: "Rejected as Unreliable"
  };
  const teamSize = row.team_size_min == null && row.team_size_max == null
    ? row.solo_participation_policy
    : `${row.team_size_min ?? "?"}-${row.team_size_max ?? "?"}`;
  const displayEnum = (value) => value ? String(value).replaceAll("_", " ") : value;
  const fee = [
    row.registration_fee_amount == null
      ? ""
      : `${row.registration_fee_amount}${row.registration_fee_currency ? ` ${row.registration_fee_currency.trim()}` : ""}`,
    row.registration_fee_notes
  ].filter(Boolean).join(" — ");
  return {
    id: row.event_id,
    event_name: row.event_name,
    organizer: row.organizer_name,
    official_website: row.official_website,
    registration_link: row.registration_link,
    rules_faq_url: row.rules_faq_link,
    city: row.city,
    state_region: row.state_region,
    country: row.country,
    venue: row.venue,
    format: row.format,
    event_start: row.event_start_date,
    event_end: row.event_end_date,
    registration_deadline: row.registration_deadline_at,
    registration_status: row.registration_status,
    last_verified_date: row.last_verified_at,
    student_eligibility: row.student_eligibility,
    outside_school_eligibility: row.outside_school_eligibility,
    international_student_wording: row.international_student_wording,
    age_rules: row.age_rules,
    team_size: teamSize,
    solo_team_formation_rules: [
      row.solo_participation_policy,
      row.team_formation_rules,
      row.all_members_must_register == null
        ? ""
        : row.all_members_must_register ? "All team members must register." : "Not all team members must register."
    ].filter(Boolean).join(" "),
    registration_fee: fee,
    travel_support: displayEnum(row.travel_support),
    lodging: displayEnum(row.lodging_support),
    meals: displayEnum(row.meals_support),
    reimbursement_conditions: row.reimbursement_conditions,
    technical_tracks: tracks.map(({ track_name, description }) => [track_name, description].filter(Boolean).join(": ")).join("; "),
    ai_policy: row.ai_tool_policy,
    pre_existing_code_policy: row.pre_existing_code_policy,
    ip_terms: row.intellectual_property_terms,
    application_requirements: [
      row.application_requirements,
      ...requirements.map(({ requirement_text }) => requirement_text)
    ].filter(Boolean).join("; "),
    prizes: awards.map(({ title, description, award_value }) =>
      [title, description, award_value].filter(Boolean).join(" — ")).join("; "),
    sponsor_recruiting_benefits: otherBenefits.map(({ title, description }) =>
      [title, description].filter(Boolean).join(" — ")).join("; "),
    evidence_links: sources.map(({ source_url, source_title }) => ({
      url: source_url,
      label: source_title
    })),
    status: statusLabels[row.operational_status] || String(row.operational_status || "").replaceAll("_", " "),
    confidence: row.evidence_confidence
      ? row.evidence_confidence[0].toUpperCase() + row.evidence_confidence.slice(1)
      : ""
  };
}
