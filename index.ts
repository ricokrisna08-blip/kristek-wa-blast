import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { readFile as readTextFile } from "fs/promises";
import { basename, extname, resolve } from "path";
import { chromium } from "playwright";
import type { Page } from "playwright";
import * as XLSX from "xlsx";
import {
  type CustomerRow,
  prepareCustomers,
  delay,
  randomDelay,
  buildMessage,
  waitForWhatsappReady,
  openAndSend,
} from "./lib/whatsapp.js";

// 🔥 MODE
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESET = args.includes("--reset");
const positional = args.filter((a) => !a.startsWith("--"));
const MODE = positional[0] || "billing";
const DATA_FILE = positional[1];

const LOG_DIR = resolve(process.cwd(), "logs");

// ================= DATA =================
const DATA_FILES = {
  billing: ["billing_tagihan_KRISTEK.csv", "billing_tagihan_KRISTEK.xlsx", "billing_tagihan_KRISTEK.xls"],
  marketing: ["catering.csv", "catering.xlsx", "catering.xls"],
  apology: ["apology.csv", "apology.xlsx", "apology.xls"],
};

function findDataFile(): string {
  const cwd = process.cwd();

  if (!(MODE in DATA_FILES)) {
    throw new Error(`Unknown MODE: ${MODE}`);
  }

  if (DATA_FILE) {
    const filePath = resolve(cwd, DATA_FILE);

    if (!existsSync(filePath)) {
      throw new Error(`Data file not found: ${DATA_FILE}`);
    }

    return filePath;
  }

  const fileNames = DATA_FILES[MODE as keyof typeof DATA_FILES];

  const paths = fileNames.flatMap((fileName) => [
    resolve(cwd, fileName),
    resolve(cwd, "data", fileName),
  ]);

  const found = paths.find((p) => existsSync(p));

  if (!found) {
    throw new Error(`Data file not found for mode: ${MODE}`);
  }

  return found;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(csvText: string): CustomerRow[] {
  const text = csvText.replace(/^﻿/, "");

  const lines = text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim());

  const headerLine = lines[0];
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] ?? "").trim();
    });

    return obj;
  });
}

function parseExcel(filePath: string): CustomerRow[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error(`Excel file has no sheet: ${filePath}`);
  }

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Excel sheet not found: ${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  return rows.map((row) => {
    const obj: any = {};

    for (const [key, value] of Object.entries(row)) {
      obj[key.trim()] = String(value ?? "").trim();
    }

    return obj;
  });
}

async function readCustomers(filePath: string): Promise<CustomerRow[]> {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".csv") {
    const csv = await readTextFile(filePath, "utf8");
    return parseCsv(csv);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    return parseExcel(filePath);
  }

  throw new Error(`Unsupported data file type: ${ext}`);
}

// ================= PROGRESS (resume support) =================
type Progress = { sent: string[] };

function getProgressFilePath(dataPath: string): string {
  const safeName = basename(dataPath).replace(/[^a-zA-Z0-9._-]/g, "_");
  return resolve(LOG_DIR, `progress-${MODE}-${safeName}.json`);
}

function loadProgress(path: string): Set<string> {
  if (RESET || !existsSync(path)) return new Set();

  try {
    const data: Progress = JSON.parse(readFileSync(path, "utf8"));
    return new Set(data.sent);
  } catch {
    return new Set();
  }
}

function saveProgress(path: string, sent: Set<string>) {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify({ sent: [...sent] }, null, 2));
}

// ================= MAIN =================
async function main() {
  const dataPath = findDataFile();
  console.log("Using data:", dataPath);

  const rawCustomers = await readCustomers(dataPath);
  const customers = prepareCustomers(rawCustomers);

  if (customers.length === 0) {
    console.log("⚠️  Tidak ada customer valid untuk dikirim. Berhenti.");
    return;
  }

  const progressPath = getProgressFilePath(dataPath);
  const sentSet = loadProgress(progressPath);

  const pending = customers.filter((c) => !sentSet.has(c.no_hp));
  const alreadySent = customers.length - pending.length;

  if (alreadySent > 0) {
    console.log(`ℹ️  ${alreadySent} customer sudah pernah dikirim sebelumnya (skip). Pakai --reset untuk kirim ulang semua.`);
  }

  if (pending.length === 0) {
    console.log("✅ Semua customer sudah pernah dikirim. Tidak ada yang perlu dikirim lagi.");
    return;
  }

  console.log(`🚀 MODE: ${MODE}${DRY_RUN ? " (DRY RUN — tidak ada pesan yang benar-benar terkirim)" : ""} — ${pending.length} pesan akan diproses`);

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let page: Page | undefined;

  if (!DRY_RUN) {
    context = await chromium.launchPersistentContext("./session", { headless: false });
    page = context.pages()[0] || (await context.newPage());
    await page.goto("https://web.whatsapp.com");
    await waitForWhatsappReady(page);
  }

  const failed: { phone: string; error: string }[] = [];
  let successCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];
    if (!c) continue;

    const tag = `[${i + 1}/${pending.length}]`;

    if (DRY_RUN) {
      console.log(`${tag} 👀 ke ${c.no_hp}:\n${buildMessage(MODE, c)}\n`);
      successCount++;
      continue;
    }

    console.log(`${tag} 📲 Kirim ke:`, c.no_hp);

    try {
      await openAndSend(page!, MODE, c);
      console.log(`${tag} ✅ terkirim`);
      successCount++;
      sentSet.add(c.no_hp);
      saveProgress(progressPath, sentSet);
    } catch (err) {
      console.log(`${tag} ❌ gagal kirim:`, err);
      failed.push({ phone: c.no_hp, error: String(err) });
    }

    await delay(randomDelay(MODE));
  }

  console.log("\n🔥 DONE");
  console.log(`✅ Berhasil : ${successCount}`);
  console.log(`❌ Gagal    : ${failed.length}`);

  if (failed.length > 0) {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const failPath = resolve(LOG_DIR, `failed-${MODE}-${Date.now()}.json`);
    writeFileSync(failPath, JSON.stringify(failed, null, 2));
    console.log(`📄 Detail nomor gagal disimpan di: ${failPath}`);
  }
}

main();
