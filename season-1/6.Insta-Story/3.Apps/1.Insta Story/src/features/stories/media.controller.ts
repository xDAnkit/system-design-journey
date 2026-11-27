import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { recordAudit } from "../audit/audit.service.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

// The browser composes the story on a canvas and posts the result as a data URL, so no multipart
// plugin is needed. 6 MB decoded is a 1080x1920 JPEG with headroom; anything bigger is a mistake.
const PREFIX = /^data:image\/(png|jpeg|webp|gif);base64,/;
const BODY = /^[A-Za-z0-9+/=\s]+$/;
const MAX_BYTES = 6 * 1024 * 1024;
const MIN_BYTES = 1024;
const EXT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

interface UploadBody {
  dataUrl?: string;
}

// POST /stories/media -> one file under public/uploads, answered with the public path.
export const upload = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const raw = String((req.body as UploadBody | undefined)?.dataUrl ?? "");
  const match = PREFIX.exec(raw);
  if (!match)
    throw httpError(
      400,
      "dataUrl must be a base64 image (png, jpeg, webp or gif)",
    );

  const base64 = raw.slice(match[0].length).replace(/\s/g, "");
  if (!BODY.test(base64)) throw httpError(400, "dataUrl is not valid base64");

  // Check the size before decoding, so a huge body never becomes a huge buffer.
  const estimate = Math.floor((base64.length * 3) / 4);
  if (estimate < MIN_BYTES) throw httpError(400, "Image looks empty");
  if (estimate > MAX_BYTES)
    throw httpError(413, "Image is larger than 6 MB after composition");

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_BYTES)
    throw httpError(413, "Image is larger than 6 MB after composition");

  const name = `${randomUUID()}.${EXT[match[1]]}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buffer);

  await recordAudit(req, {
    action: "story.media",
    entity: "uploads",
    entityId: name,
    userId: user,
    status: 201,
  });
  await reply.code(201).send({ url: `/uploads/${name}`, bytes: buffer.length });
};
