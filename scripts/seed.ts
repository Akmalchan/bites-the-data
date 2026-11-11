// Rebuild the base world (drops agent checkpoints from the UI). Uses the same backend as the server.
import "dotenv/config";
import { DeltaApp } from "../server/app.ts";

const app = new DeltaApp();
await app.init();
await app.seed();
const b = app.backend();
console.log(`Seeded base world on ${b.label} (${b.detail}):`, app.seedInfo);
