import { InMemoryEvaluationCampaignRepository } from "../../src/evaluation/evaluation-campaign-repository.js";

import { runEvaluationCampaignRepositoryContract } from "./evaluation-campaign-repository-contract.js";

const NOW = "2026-08-03T14:00:00.000Z";

runEvaluationCampaignRepositoryContract("in-memory", () =>
  new InMemoryEvaluationCampaignRepository({ clock: { now: () => new Date(NOW) } }),
);
