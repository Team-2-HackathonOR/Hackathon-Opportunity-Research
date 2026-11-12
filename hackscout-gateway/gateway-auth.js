const { timingSafeEqual } = require("node:crypto");

function requireGateway(request, response, next) {
  const expected = process.env.GATEWAY_INTERNAL_SECRET;
  if (!expected) {
    console.error("HackScout gateway authorization is not configured.");
    return response.status(503).json({ error: "Gateway authorization is not configured." });
  }
  const supplied = request.get("x-gateway-secret");
  const valid = typeof supplied === "string" &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!valid || request.get("x-gateway-caller") !== "team-2-gateway") {
    console.warn("Direct HackScout API access denied.");
    return response.status(403).json({ error: "Use the main gateway to access the HackScout API." });
  }
  request.gatewayAuthenticated = true;
  next();
}

module.exports = { requireGateway };
