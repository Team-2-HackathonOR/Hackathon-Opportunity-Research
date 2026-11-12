function eligibilityMatches(event) {
  const student = $("#student-filter").value;
  const undergraduate = $("#undergrad-filter").value;
  const outsideUniversity = $("#outside-school-filter").value;
  const international = $("#international-filter").value;
  const ageRule = $("#age-filter").value;
  const myAge = $("#my-age-filter").value === "" ? null : Number($("#my-age-filter").value);
  const geography = $("#geography-filter").value.trim().toLowerCase();
  const invitation = $("#invitation-filter").value;
  const teamSize = $("#team-size-filter").value === "" ? null : Number($("#team-size-filter").value);
  const participation = $("#participation-filter").value;
  const teamFormation = $("#team-formation-filter").value;
  const membersRegister = $("#members-register-filter").value;
  const triState = (selected, actual) => !selected || actual === selected;

  if (myAge !== null && (!Number.isInteger(myAge) || myAge < 1 || myAge > 120)) return false;
  if (!triState(student, event.student)) return false;
  if (!triState(undergraduate, event.undergraduate)) return false;
  if (!triState(outsideUniversity, event.outsideUniversity)) return false;
  if (!triState(international, event.international)) return false;
  if (!triState(invitation, event.invitation)) return false;
  if (!triState(teamFormation, event.teamFormation)) return false;
  if (!triState(membersRegister, event.allMembersRegister)) return false;
  if (ageRule === "unknown" && event.age !== null) return false;
  if (ageRule === "none" && (!event.age || event.age.min !== null || event.age.max !== null)) return false;
  if (ageRule === "restricted" && (!event.age || (event.age.min === null && event.age.max === null))) return false;
  if (myAge !== null && (!event.age || (event.age.min !== null && myAge < event.age.min) || (event.age.max !== null && myAge > event.age.max))) return false;
  if (geography && !event.geography.toLowerCase().includes(geography) && !/worldwide|global/i.test(event.geography)) return false;
  if (teamSize !== null && (event.teamMin === null || event.teamMax === null || teamSize < event.teamMin || teamSize > event.teamMax)) return false;
  if (participation === "solo" && event.solo !== "yes") return false;
  if (participation === "team" && (event.solo !== "no" || event.teamMin === null || event.teamMin < 2)) return false;
  return true;
}
function getFilteredEvents() {
  const keyword = $("#keyword-input").value.trim().toLowerCase();
  const location = $("#location-input").value.trim().toLowerCase();
  const selectedDate = $("#date-input").value;
  const format = $("#format-filter").value;
  const cost = $("#cost-filter").value;
  const withinDays = Number($("#when-filter").value);
  const includeClosed = $("#include-closed").checked;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = events.filter((event) => {
    const searchableDetails = event.details.map(([, value]) => value).join(" ");
    const haystack = `${event.title} ${event.organizer} ${event.topic} ${event.location} ${event.format} ${event.cost} ${event.category.join(" ")} ${searchableDetails}`.toLowerCase();
    const eventDate = event.date ? new Date(`${event.date}T00:00:00`) : null;
    const daysUntil = eventDate ? (eventDate - today) / 86400000 : Infinity;
    const categoryMatches = activeCategory === "All" ||
      (activeCategory === "Beginner" ? event.beginner : event.category.some((category) => category.toLowerCase() === activeCategory.toLowerCase()));
    const locationMatches = !location || event.location.toLowerCase().includes(location) ||
      (["online", "virtual", "remote"].some((word) => location.includes(word)) && event.format === "Virtual");
    return (includeClosed || event.status !== "Closed/Expired") &&
      keyword.split(/\s+/).every((term) => haystack.includes(term)) && locationMatches && categoryMatches &&
      (!format || event.format === format) && (!cost || event.cost === cost) &&
      (!selectedDate || (event.date && event.date <= selectedDate && event.endDate >= selectedDate)) &&
      (!withinDays || (daysUntil >= 0 && daysUntil <= withinDays)) && (!savedOnly || saved.has(event.id)) &&
      eligibilityMatches(event);
  });
  const sort = $("#sort-select").value;
  result.sort((a, b) => {
    if (sort === "name") return a.title.localeCompare(b.title);
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
    return sort === "latest" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  return result;
}
