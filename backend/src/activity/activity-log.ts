import mongoose, { Schema } from "mongoose";
import { z } from "zod";
import { DEMO } from "../security/demo-flags";

let conn: mongoose.Connection | null = null;

export async function connectActivityMongo(): Promise<mongoose.Connection> {
  if (conn) return conn;
  const uri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/activity_log";
  conn = await mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
  return conn;
}

const activitySchema = new Schema(
  {
    actorUserId: { type: String, index: true },
    action: { type: String, required: true, index: true },
    ip: { type: String },
    path: { type: String },
    meta: { type: Schema.Types.Mixed },
    at: { type: Date, default: Date.now, index: true },
  },
  { collection: "activity_log", capped: false }
);

export function activityModel(): mongoose.Model<any> {
  const c = conn ?? mongoose.connection;
  return c.models.Activity ?? c.model("Activity", activitySchema);
}

export async function recordActivity(entry: {
  actorUserId?: string; action: string; ip?: string; path?: string; meta?: Record<string, unknown>;
}): Promise<void> {
  await connectActivityMongo();
  await activityModel().create({ ...entry, at: new Date() });
}

export const activitySearchSchema = z
  .object({
    action: z.string().max(64).optional(),
    actorUserId: z.string().uuid().optional(),
    ip: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export type ActivitySearch = z.infer<typeof activitySearchSchema>;

export async function searchActivity(raw: unknown): Promise<unknown[]> {
  await connectActivityMongo();
  const model = activityModel();

  if (DEMO.MONGO_RAW_FILTER) {
    const rawFilter = (raw ?? {}) as Record<string, unknown>;
    const { limit, ...filter } = rawFilter;
    return model.find(filter).limit(Number(limit) || 50).lean().exec();
  }

  const parsed = activitySearchSchema.safeParse(raw);
  if (!parsed.success) {
    const e: any = new Error("invalid search"); e.httpStatus = 400; throw e;
  }
  const filter: Record<string, string> = {};
  if (parsed.data.action) filter.action = parsed.data.action;
  if (parsed.data.actorUserId) filter.actorUserId = parsed.data.actorUserId;
  if (parsed.data.ip) filter.ip = parsed.data.ip;

  return model.find(filter).sort({ at: -1 }).limit(parsed.data.limit ?? 50).lean().exec();
}

export async function closeActivityMongo(): Promise<void> {
  if (conn) { await conn.close(); conn = null; }
}
