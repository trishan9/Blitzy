import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { DEMO } from "../security/demo-flags";

export class UploadRejected extends Error {
  readonly httpStatus = 400;
  constructor(readonly reason: string) {
    super("the uploaded file is not a permitted image");
    this.name = "UploadRejected";
  }
}

const ALLOWED_DETECTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const FORBIDDEN_DETECTED = new Set(["image/svg+xml", "image/gif", "application/xml", "text/xml"]);

export const MULTER_LIMITS = {
  fileSize: 5 * 1024 * 1024,
  files: 10,
  fields: 20,
  parts: 30,
} as const;

const MAX_DIMENSION = 6000;

export interface ProcessedImage {
  storageKey: string;
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
  bytes: number;
}

export function claimedExtension(originalName: string): string {
  const base = originalName.split(/[\\/]/).pop() ?? "";
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx + 1).toLowerCase();
}

export async function processImageUpload(
  buffer: Buffer,
  originalName: string,
  claimedMimetype: string
): Promise<ProcessedImage> {
  if (buffer.length === 0) throw new UploadRejected("empty-file");

  if (DEMO.TRUST_UPLOAD_MIMETYPE) {
    if (!claimedMimetype.startsWith("image/")) throw new UploadRejected("claimed-not-image");
    return {
      storageKey: DEMO.TRUST_UPLOAD_FILENAME ? originalName : `${uuidv7()}.webp`,
      buffer,
      contentType: "image/webp",
      width: 0,
      height: 0,
      bytes: buffer.length,
    };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) throw new UploadRejected("undetectable-type");
  if (FORBIDDEN_DETECTED.has(detected.mime)) throw new UploadRejected(`forbidden-type:${detected.mime}`);
  if (!ALLOWED_DETECTED.has(detected.mime)) throw new UploadRejected(`type-not-allowed:${detected.mime}`);

  const ext = claimedExtension(originalName);
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) throw new UploadRejected(`extension-not-allowed:${ext}`);

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new UploadRejected("undecodable-image");
  }
  if (!meta.width || !meta.height) throw new UploadRejected("no-dimensions");
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new UploadRejected("dimensions-too-large");
  }

  const out = await sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return {
    storageKey: `${uuidv7()}.webp`,
    buffer: out.data,
    contentType: "image/webp",
    width: out.info.width,
    height: out.info.height,
    bytes: out.data.length,
  };
}

export const serveHeaders = {
  "Content-Disposition": "attachment",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cache-Control": "private, no-store",
} as const;
