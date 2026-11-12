import type { FastifyPluginAsync } from "fastify";

import { registerEventDetailGeneralRoutes } from "./event-detail-general.js";
import { registerEventDetailRecordRoutes } from "./event-detail-records.js";
import { registerEventDetailShortlistRoutes } from "./event-detail-shortlist.js";
import { registerEventDetailRequirementRoutes } from "./event-detail-requirements.js";
import { registerEventDetailVerificationRoutes } from "./event-detail-verifications.js";

export const eventDetailRoutes: FastifyPluginAsync = async (app) => {
  await registerEventDetailGeneralRoutes(app);
  await registerEventDetailRecordRoutes(app);
  await registerEventDetailShortlistRoutes(app);
  await registerEventDetailRequirementRoutes(app);
  await registerEventDetailVerificationRoutes(app);
};
