// CLI за ръчно пускане на агентите: npm run discover | classify | pipeline
import "dotenv/config";
import { runDiscovery } from "./agents/discovery.js";
import { runClassifier, buildPrompt } from "./agents/classifier.js";
import { runDocumenter, buildDocPrompt } from "./agents/documenter.js";
import { runDeadlines } from "./agents/deadlines.js";
import { db } from "./database/db.js";

const cmd = process.argv[2] || "pipeline";

const steps = {
  discover: async () => runDiscovery(),
  classify: async () => runClassifier(),
  document: async () => runDocumenter(),
  deadlines: async () => runDeadlines(),
  "document:dry": async () => {
    const t = db.data.tenders.find((x) => x.status === "RELEVANT") || db.data.tenders.find((x) => x.status === "DRAFTED");
    if (!t) return console.log("няма RELEVANT поръчки — пусни първо classify");
    const { system, user } = buildDocPrompt(t);
    console.log("=== ДОКУМЕНТ ЗА:", t.id, "===\n--- SYSTEM ---\n" + system + "\n\n--- USER ---\n" + user);
  },
  // Показва prompt-а, който БИ се пратил на Claude за първата NEW поръчка — без API ключ.
  "classify:dry": async () => {
    const t = db.data.tenders.find((x) => x.status === "NEW") || db.data.tenders[0];
    if (!t) return console.log("няма поръчки — пусни първо discover");
    const { system, user } = buildPrompt(t);
    console.log("=== ПОРЪЧКА:", t.id, "===\n");
    console.log("--- SYSTEM ---\n" + system + "\n");
    console.log("--- USER ---\n" + user);
  },
  pipeline: async () => {
    await runDiscovery();
    await runClassifier();
    await runDocumenter();
    await runDeadlines();
  },
};

const fn = steps[cmd];
if (!fn) {
  console.error(`Непозната команда: ${cmd}. Налични: ${Object.keys(steps).join(", ")}`);
  process.exit(1);
}
await fn();
process.exit(0);
