import "./env";
import "dotenv/config";
import { recordActivity, searchActivity, closeActivityMongo, connectActivityMongo, activityModel } from "../activity/activity-log";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

async function main() {
  process.env.MONGO_URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:57017/activity_log";
  await connectActivityMongo();
  await activityModel().deleteMany({});

  for (let i = 0; i < 10; i++) await recordActivity({ action: "ORDER_CREATED", actorUserId: undefined, ip: "1.2.3.4" });
  await recordActivity({ action: "SECRET_ADMIN_ACTION", ip: "9.9.9.9" });

  const legit = await searchActivity({ action: "SECRET_ADMIN_ACTION" });
  ok(legit.length === 1, `scalar search returns the one match (${legit.length})`);

  let injThrew = false;
  try {
    const inj = await searchActivity({ action: { $ne: null } });
    ok(inj.length <= 1, `operator injection did NOT match everything (got ${inj.length})`);
  } catch {
    injThrew = true;
    ok(true, "operator injection {$ne:null} rejected by .strict()/z.string() (400)");
  }
  ok(injThrew, "the object filter was refused before the driver");

  let whereRejected = false;
  try { await searchActivity({ $where: "return true" }); }
  catch { whereRejected = true; }
  ok(whereRejected, "$where JS-execution filter rejected");

  let regexRejected = false;
  try { await searchActivity({ action: { $regex: "(a+)+$" } }); }
  catch { regexRejected = true; }
  ok(regexRejected, "$regex object filter rejected");

  await activityModel().deleteMany({});
  await closeActivityMongo();
  console.log(`\nMongo NoSQL injection: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
