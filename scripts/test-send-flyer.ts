// Kirim SATU flyer tagihan test ke nomor tertentu -- TIDAK nyentuh data
// Supabase/Pelanggan sama sekali (datanya dummy, hardcode di bawah).
// Dipakai buat verifikasi manual openAndSendImage (attach gambar +
// caption di WhatsApp Web) sebelum dipercaya buat blast massal beneran
// lewat daemon.ts.
//
// Jalankan dari folder ini:
//   npx tsx scripts/test-send-flyer.ts 08123456789
//
// (isi nomor HP kamu sendiri -- boleh format 08xxx atau 628xxx, sama-sama
// dinormalisasi otomatis)

import { chromium } from "playwright";
import { rm } from "fs/promises";
import {
  openAndSendImage,
  buildBillingCaption,
  normalizePhone,
  waitForWhatsappReady,
  type CustomerRow,
} from "../lib/whatsapp.js";
import { renderFlyerToTempFile } from "../lib/renderFlyer.js";

async function main() {
  const rawPhone = process.argv[2];
  if (!rawPhone) {
    console.error("Pakai: npx tsx scripts/test-send-flyer.ts <no_hp>");
    process.exit(1);
  }

  const phone = normalizePhone(rawPhone);
  if (!phone || phone.length < 10) {
    console.error(`Nomor HP tidak valid: "${rawPhone}"`);
    process.exit(1);
  }

  const testCustomer: CustomerRow = {
    no_hp: phone,
    nama: "Test Pelanggan",
    periode: "Agustus 2026",
    jatuh_tempo: "03 September 2026",
    tagihan: "165000",
    invoice_no: "082026",
    is_prorata: true,
    is_kompensasi: false,
  };

  console.log("🔄 Buka browser WhatsApp Web (pakai sesi login yang sama seperti daemon)...");
  const context = await chromium.launchPersistentContext("./session", { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://web.whatsapp.com");
  await waitForWhatsappReady(page);

  console.log("🖼️  Render flyer...");
  const flyerPath = await renderFlyerToTempFile(context, testCustomer);
  console.log("✅ Flyer dirender ke:", flyerPath);

  try {
    console.log(`📲 Kirim ke ${phone}...`);
    await openAndSendImage(page, phone, flyerPath, buildBillingCaption(testCustomer));
    console.log("✅ Terkirim! Cek WhatsApp di nomor tersebut.");
  } catch (err) {
    console.error("❌ Gagal kirim:", err);
    console.error(
      "   Kemungkinan selector attach-menu/file-input/tombol-kirim di openAndSendImage (lib/whatsapp.ts) sudah beda dari struktur WhatsApp Web saat ini."
    );
  } finally {
    await rm(flyerPath, { force: true });
  }

  await context.close();
}

main();
