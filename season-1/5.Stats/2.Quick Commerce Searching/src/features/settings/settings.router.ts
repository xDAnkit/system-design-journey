import type { FastifyPluginAsync } from "fastify";
import { aiSettingsSchema, readAiSettings, saveAiSettings } from "../../ai/ai.settings.js";
import { ai, configuredProviders, isProviderConfigured } from "../../ai/index.js";
import { activeProductsCollection } from "../../search/typesense.schema.js";
import { requireAdmin } from "../../shared/admin-auth.js";
import { httpError } from "../../shared/error.js";
import { parse } from "../../shared/validate.js";

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAdmin);

  /** What the AI module uses now, what .env says, and which providers have a key */
  app.get("/ai", async () => {
    const active = await activeProductsCollection().catch(() => null);
    return {
      ...ai.status(),
      saved: await readAiSettings().catch(() => null),
      configuredProviders: configuredProviders(),
      searchIndex: active ? { collection: active.collection, embedModel: active.embedModel, dims: active.dims, needsReindex: active.embedModel !== ai.embedModelId() } : null,
    };
  });

  /** The "button": switch the LLM for the API and every worker, no restart. Embeddings stay on .env (a switch needs pnpm reindex). */
  app.put("/ai", async (req) => {
    const body = parse(aiSettingsSchema, req.body);
    if (!isProviderConfigured(body.provider)) throw httpError(400, `${body.provider} has no API key in .env`);
    await saveAiSettings(body);
    return { saved: body };
  });

  /** Back to the .env choice */
  app.delete("/ai", async () => {
    await saveAiSettings(null);
    return { saved: null, llm: ai.currentLlm() };
  });
};

export default settingsRoutes;
