function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function formatDate(iso, options = { month: "short", day: "numeric" }) {
  if (!iso) return "Date TBD";
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", options);
}
function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}
function classifyEligibility(value, affirmative, negative) {
  if (negative.test(value || "")) return "no";
  if (affirmative.test(value || "")) return "yes";
  return "unknown";
}
