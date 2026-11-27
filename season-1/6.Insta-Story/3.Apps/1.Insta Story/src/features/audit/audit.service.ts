import type { FastifyRequest } from "fastify";
import { logger } from "../../bootstrap/logger.js";
import { AuditEvent } from "./audit.model.js";
import type { ClientMeta } from "../../shared/client-meta.js";

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  status?: number | null;
  durationMs?: number | null;
}

const fromClient = (client: ClientMeta | undefined, input: AuditInput) => ({
  requestId: client?.requestId ?? null,
  userId: input.userId ?? null,
  clientId: client?.clientId ?? null,
  action: input.action,
  entity: input.entity,
  entityId: input.entityId ?? null,
  ip: client?.ip ?? null,
  socketIp: client?.socketIp ?? null,
  ipHash: client?.ipHash ?? null,
  ua: client?.ua ?? null,
  browser: client?.browser ?? null,
  os: client?.os ?? null,
  device: client?.device ?? null,
  lang: client?.lang ?? null,
  timezone: client?.timezone ?? null,
  referer: client?.referer ?? null,
  geo: client?.geo ?? null,
  status: input.status ?? null,
  durationMs: input.durationMs ?? null,
  at: new Date(),
});

// A failed audit write must never fail the user's action: it is logged loudly instead.
// The handler's own row (with the audit snapshot) still exists, so evidence is not fully lost.
export const recordAudit = async (
  req: FastifyRequest,
  input: AuditInput,
): Promise<void> => {
  try {
    await AuditEvent.create(fromClient(req.client, input));
  } catch (err) {
    logger.error(
      `Audit write failed (${input.action} ${input.entity}:${input.entityId ?? "-"}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
