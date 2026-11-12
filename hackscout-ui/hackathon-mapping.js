function mapHackathon(row) {
  const tracks = row.technical_tracks || "";
  const categorySource = [
    row.event_name,
    tracks,
    row.ai_policy,
    row.prizes,
    row.sponsor_recruiting_benefits,
    row.application_requirements
  ].filter(Boolean).join(" ");
  const categoryRules = [
    { name: "AI", pattern: /\b(ai|artificial intelligence|machine learning|data science|data analytics|data visualization|predictive analytics|natural language processing|computer vision)\b/i, art: "art-ai" },
    { name: "VR/AR", pattern: /\b(vr|virtual reality|augmented reality|mixed reality|extended reality|xr)\b/i, art: "art-vr" },
    { name: "Climate", pattern: /\b(climate|sustainability|sustainable|clean energy|renewable energy|environment|environmental|conservation|water quality|agriculture)\b/i, art: "art-climate" },
    { name: "Health", pattern: /\b(health|healthcare|medical|wellness|biotech|biomedical|public health|patient|disease|fitness)\b/i, art: "art-health" },
    { name: "Gaming", pattern: /\b(gaming|games?|video game|game development|game design|interactive game)\b/i, art: "art-gaming" },
    { name: "Social impact", pattern: /\b(social impact|social good|civic|community|communities|accessibility|public service|underserved|nonprofit|justice)\b/i, art: "art-civic" },
    { name: "Web3", pattern: /\b(web3|blockchain|crypto|decentralized)\b/i, art: "art-web" },
    { name: "Cybersecurity", pattern: /\b(cybersecurity|cyber security|information security|data protection|privacy|fraud prevention)\b/i, art: "art-security" },
    { name: "Education", pattern: /\b(education|educational|learning|edtech|classroom|curriculum|literacy|teaching)\b/i, art: "art-education" },
    { name: "Fintech", pattern: /\b(fintech|finance|financial|payments|banking|insurance)\b/i, art: "art-fintech" },
    { name: "Robotics & hardware", pattern: /\b(robotics|robot|hardware|embedded systems|iot|internet of things|sensors?|wearables?|connected devices?)\b/i, art: "art-hardware" },
    { name: "Apps & software", pattern: /\b(app development|application development|mobile apps?|software development|web development|app challenge)\b/i, art: "art-software" },
    { name: "Science & research", pattern: /\b(science|scientific|research|laboratory|laboratories|clinical research)\b/i, art: "art-science" },
    { name: "Transportation", pattern: /\b(transportation|mobility|vehicles?|transit|automotive|traffic|commuting|railway)\b/i, art: "art-transport" },
    { name: "Productivity & work", pattern: /\b(productivity|workflow|workplace|business process|entrepreneurship)\b/i, art: "art-work" }
  ];
  const category = categoryRules.filter(({ pattern }) => pattern.test(categorySource)).map(({ name }) => name);
  const date = row.event_start ? String(row.event_start).slice(0, 10) : null;
  const format = ({ in_person: "In-person", virtual: "Virtual", hybrid: "Hybrid" })[row.format] || "Not confirmed";
  const location = row.format === "virtual" ? "Online" :
    [row.venue, row.city, row.state_region, row.country].filter(Boolean).join(", ") || "Location not confirmed";
  const fee = row.registration_fee || "";
  const cost = /\bfree|no fee|no cost\b/i.test(fee) ? "Free" :
    /\b(paid|fee required|registration fee|usd|\$)\b/i.test(fee) ? "Paid" : "Not confirmed";
  const teamSize = row.team_size || "";
  const teamRange = teamSize.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  const soloTeam = /\bsolo\b/i.test(teamSize);
  const rulesFaqUrl = row.rules_faq_url || "";
  const studentEligibility = classifyEligibility(
    row.student_eligibility,
    /\b(required|must be|students only|only students)\b/i,
    /\b(not required|no student requirement|non[- ]students|open to all|anyone may)\b/i
  );
  const student = studentEligibility === "yes" ? "required" :
    studentEligibility === "no" ? "not-required" : "unknown";
  const outsideUniversity = classifyEligibility(
    row.outside_school_eligibility,
    /\b(allowed|eligible|open to|accepted)\b/i,
    /\b(not allowed|ineligible|not eligible|university students only|school students only)\b/i
  );
  const international = classifyEligibility(
    row.international_student_wording,
    /\b(allowed|eligible|open to|accepted)\b/i,
    /\b(not allowed|ineligible|not eligible|cannot participate|not accepted)\b/i
  );
  const officialWebsite = row.official_website || "";
  const registrationLink = row.registration_link || "";
  return {
    id: String(row.id),
    title: row.event_name,
    organizer: row.organizer || "Organizer not listed",
    topic: tracks.split(/[,;\n]/).map((part) => part.trim()).find(Boolean) || "Hackathon",
    category,
    date,
    endDate: dateOnly(row.event_end) || date,
    location,
    format,
    cost,
    mark: (category[0] || "H").slice(0, 3).toUpperCase(),
    art: categoryRules.find(({ pattern }) => pattern.test(categorySource))?.art || "art-general",
    label: row.status || "Hackathon listing",
    beginner: /\b(beginner|first[- ]time|new to hackathons)\b/i.test(`${tracks} ${row.application_requirements || ""}`),
    student,
    undergraduate: "unknown",
    outsideUniversity: outsideUniversity === "yes" || outsideUniversity === "no" ? outsideUniversity : "unknown",
    international: international === "yes" || international === "no" ? international : "unknown",
    age: null,
    geography: [row.country, row.outside_school_eligibility, row.international_student_wording].filter(Boolean).join(" ") || "Needs confirmation",
    invitation: "unknown",
    teamMin: soloTeam ? 1 : teamRange ? Number(teamRange[1]) : null,
    teamMax: soloTeam ? 1 : teamRange ? Number(teamRange[2]) : null,
    solo: soloTeam ? "yes" : teamRange && Number(teamRange[1]) > 1 ? "no" : "unknown",
    teamFormation: "unknown",
    allMembersRegister: "unknown",
    description: tracks || row.application_requirements || "See the official event website for details.",
    officialWebsite,
    registrationLink,
    rulesFaqUrl,
    status: row.status,
    confidence: row.confidence,
    details: [
      ["Event dates", row.event_start && row.event_end ? `${dateOnly(row.event_start)} to ${dateOnly(row.event_end)}` : dateOnly(row.event_start || row.event_end)],
      ["Registration deadline", dateOnly(row.registration_deadline)],
      ["Registration status", row.registration_status],
      ["Last verified", dateOnly(row.last_verified_date)],
      ["Student eligibility", row.student_eligibility],
      ["Outside-school eligibility", row.outside_school_eligibility],
      ["International student wording", row.international_student_wording],
      ["Age rules", row.age_rules],
      ["Team size", row.team_size],
      ["Solo/team rules", row.solo_team_formation_rules],
      ["Registration fee", row.registration_fee],
      ["Travel support", row.travel_support],
      ["Lodging", row.lodging],
      ["Meals", row.meals],
      ["Reimbursement conditions", row.reimbursement_conditions],
      ["Technical tracks", row.technical_tracks],
      ["AI policy", row.ai_policy],
      ["Pre-existing code policy", row.pre_existing_code_policy],
      ["IP terms", row.ip_terms],
      ["Judging criteria", row.judging_criteria],
      ["Prizes", row.prizes],
      ["Sponsor/recruiting benefits", row.sponsor_recruiting_benefits],
      ["Application requirements", row.application_requirements]
    ].filter(([, value]) => value)
  };
}
