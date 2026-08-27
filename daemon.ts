// Daemon KRISTEK WA Blast.
//
// Beda dari index.ts (CLI manual, baca data dari Excel/CSV lokal, dipicu
// sendiri lewat `npm start`), daemon ini JALAN TERUS di background:
// - Login sekali ke Supabase pakai akun khusus "System WA Blast" (role
//   Pemilik, lihat .env.example) supaya bisa baca data Pelanggan lintas
//   Wilayah.
// - Buka browser WhatsApp Web SEKALI (session persist di ./session, sama
//   seperti index.ts), dipakai ulang buat semua job -- bukan buka-tutup
//   tiap job, biar polanya gak makin "robot-like" di mata WhatsApp.
// - Polling tabel wa_blast_job tiap POLL_INTERVAL_MS, proses job
//   "pending" satu-satu (FIFO), update progress-nya biar keliatan live
//   di app KRISTEK.
// - node-cron: tiap tanggal 1 jam 09:00, auto-insert job billing baru
//   sendiri (skip kalau kebetulan masih ada job billing yang belum
//   selesai) -- otomatis lewat pipeline yang SAMA dengan job yang dipicu
//   manual dari tombol di app.
//
// Cara jalanin: `npm run daemon` di folder ini, biarin terminal-nya
// tetap kebuka (atau pakai `pm2 start "npm run daemon"` / macOS
// LaunchAgent kalau mau auto-start & tetap jalan walau terminal ditutup
// -- lihat README.md).

import { chromium } from "playwright";
import type { Page } from "playwright";
import cron from "node-cron";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectSupabase } from "./lib/supabaseClient.js";
import { fetchBillingFromSupabase } from "./lib/fetchBillingFromSupabase.js";
import { prepareCustomers, delay, randomDelay, openAndSend, waitForWhatsappReady } from "./lib/whatsapp.js";

const POLL_INTERVAL_MS = 20_000;
const CRON_SCHEDULE = "0 9 1 * *"; // menit jam tanggal bulan hari -- tanggal 1 jam 09:00

type WaBlastJobRow = {
  id: string;
  mode: string;
  status: string;
  pelanggan_ids: string[] | null;
};

async function insertScheduledJobIfNeeded(client: SupabaseClient, userId: string) {
  const { data: activeJobs } = await client
    .from("wa_blast_job")
    .select("id")
    .eq("mode", "billing")
    .in("status", ["pending", "running"])
    .limit(1);

  if (activeJobs && activeJobs.length > 0) {
    console.log("⏭️  Sudah ada job billing yang belum selesai, skip auto-trigger jadwal bulanan.");
    return;
  }

  const { error } = await client
    .from("wa_blast_job")
    .insert({ mode: "billing", requested_by: userId });

  if (error) {
    console.log("❌ Gagal auto-insert job billing terjadwal:", error.message);
    return;
  }

  console.log("📅 Job billing terjadwal (tanggal 1, 09:00) berhasil dibuat.");
}

async function fetchNextPendingJob(client: SupabaseClient): Promise<WaBlastJobRow | null> {
  const { data, error } = await client
    .from("wa_blast_job")
    .select("id, mode, status, pelanggan_ids")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.log("❌ Gagal cek job pending:", error.message);
    return null;
  }

  return data?.[0] ?? null;
}

async function processJob(client: SupabaseClient, page: Page, job: WaBlastJobRow) {
  console.log(`\n🚀 Mulai job ${job.id} (mode: ${job.mode})`);

  if (job.mode !== "billing") {
    await client
      .from("wa_blast_job")
      .update({
        status: "failed",
        error: `Mode "${job.mode}" belum didukung daemon (cuma "billing" yang bisa dipicu dari app).`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.log(`❌ Job ${job.id} ditolak: mode tidak didukung.`);
    return;
  }

  let customers;
  try {
    const raw = await fetchBillingFromSupabase(client, job.pelanggan_ids);
    customers = prepareCustomers(raw);
  } catch (err) {
    await client
      .from("wa_blast_job")
      .update({
        status: "failed",
        error: `Gagal ambil data: ${err instanceof Error ? err.message : String(err)}`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.log(`❌ Job ${job.id} gagal ambil data:`, err);
    return;
  }

  await client
    .from("wa_blast_job")
    .update({ status: "running", total: customers.length, started_at: new Date().toISOString() })
    .eq("id", job.id);

  if (customers.length === 0) {
    await client
      .from("wa_blast_job")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", job.id);
    console.log(`✅ Job ${job.id} selesai -- tidak ada Pelanggan yang belum bayar.`);
    return;
  }

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if (!c) continue;

    const tag = `[${i + 1}/${customers.length}]`;
    console.log(`${tag} 📲 Kirim ke:`, c.no_hp);

    try {
      await openAndSend(page, job.mode, c);
      sentCount++;
      console.log(`${tag} ✅ terkirim`);

      // Nandain Pelanggan ini udah kekirim bulan ini -- dibaca
      // fetchBillingFromSupabase.ts biar blast-penuh berikutnya (manual
      // atau cron bulanan) skip dia, nggak kirim dobel. Error di sini
      // dicatat log doang (bukan masuk failedCount) karena pesan WA-nya
      // sendiri sudah beneran terkirim.
      if (job.mode === "billing" && c.id) {
        const { error: markError } = await client
          .from("pelanggan")
          .update({ sudah_diblast_bulan_ini: true, diblast_at: new Date().toISOString() })
          .eq("id", c.id);
        if (markError) {
          console.log(`${tag} ⚠️  Gagal nandain sudah_diblast_bulan_ini:`, markError.message);
        }
      }
    } catch (err) {
      failedCount++;
      console.log(`${tag} ❌ gagal kirim:`, err);
    }

    await client
      .from("wa_blast_job")
      .update({ sent_count: sentCount, failed_count: failedCount })
      .eq("id", job.id);

    await delay(randomDelay(job.mode));
  }

  await client
    .from("wa_blast_job")
    .update({ status: "done", finished_at: new Date().toISOString() })
    .eq("id", job.id);

  console.log(`\n🔥 Job ${job.id} selesai — ✅ ${sentCount} terkirim, ❌ ${failedCount} gagal`);
}

async function main() {
  console.log("=== KRISTEK WA Blast Daemon ===");

  const { client, userId } = await connectSupabase();

  console.log("🔄 Buka browser WhatsApp Web...");
  const context = await chromium.launchPersistentContext("./session", { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://web.whatsapp.com");
  await waitForWhatsappReady(page);

  cron.schedule(CRON_SCHEDULE, () => {
    insertScheduledJobIfNeeded(client, userId).catch((err) =>
      console.log("❌ Error di cron jadwal bulanan:", err)
    );
  });
  console.log(`⏰ Jadwal otomatis aktif: "${CRON_SCHEDULE}" (tanggal 1 tiap bulan, jam 09:00).`);

  console.log(`👀 Polling job tiap ${POLL_INTERVAL_MS / 1000} detik. Tekan Ctrl+C untuk berhenti.`);

  let isProcessing = false;

  setInterval(async () => {
    if (isProcessing) return;

    const job = await fetchNextPendingJob(client);
    if (!job) return;

    isProcessing = true;
    try {
      await processJob(client, page, job);
    } catch (err) {
      console.log(`❌ Error tak terduga waktu proses job ${job.id}:`, err);
    } finally {
      isProcessing = false;
    }
  }, POLL_INTERVAL_MS);

  process.on("SIGINT", async () => {
    console.log("\n👋 Daemon dihentikan, tutup browser...");
    await context.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("❌ Daemon gagal start:", err);
  process.exit(1);
});
