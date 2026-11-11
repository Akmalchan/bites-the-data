import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRCHECK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DELTA_DIR = resolve(PRCHECK_DIR, "..");
export const REPORTS_DIR = `${PRCHECK_DIR}/reports`;
export const PORT = Number(process.env.BITES_PR_PORT ?? 5195);
