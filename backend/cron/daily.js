// Дневен конвейер: discovery → classify → deadlines, всеки ден в 07:00.
import "dotenv/config";
import cron from "node-cron";
import { runDiscovery } from "../src/agents/discovery.js";
import { runClassifier } from "../src/agents/classifier.js";
import { runDocumenter } from "../src/agents/documenter.js";
import { runDeadlines } from "../src/agents/deadlines.js";

async function pipeline() {
  console.log(`[cron] старт ${new Date().toISOString()}`);
  await runDiscovery();
  await runClassifier();
  await runDocumenter();
  await runDeadlines();
  console.log("[cron] готово");
}

// 07:00 всеки ден (часова зона на сървъра)
cron.schedule("0 7 * * *", pipeline);
console.log("[cron] планиран дневен конвейер в 07:00. Ctrl+C за изход.");

// Пусни веднъж при старт, ако подадеш --now
if (process.argv.includes("--now")) pipeline();
