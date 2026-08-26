// Kirim 3 pesan tagihan (teks biasa) test ke nomor yang sama -- varian
// normal, prorata, dan kompensasi -- TIDAK nyentuh data Supabase/Pelanggan
// sama sekali (datanya dummy, hardcode di bawah). Dipakai buat verifikasi
// manual openAndSend (template teks yang sudah di-revert) sebelum
// dipercaya buat blast massal beneran lewat daemon.ts.
//
// Jalankan dari folder ini:
//   npx tsx scripts/test-send-billing.ts 08123456789
//
// (isi nomor HP kamu sendiri -- boleh format 08xxx atau 628xxx, sama-sama
// dinormalisasi otomatis)

import { chromium } from "playwright";
import {
  openAndSend,
  normalizePhone,
  waitForWhatsappReady,
  delay,
  type CustomerRow,
} from "../lib/whatsapp.js";

async function main() {
  const rawPhone = process.argv[2];
  if (!rawPhone) {
    console.error("Pakai: npx tsx scripts/test-send-billing.ts <no_hp>");
    process.exit(1);
  }

  const phone = normalizePhone(rawPhone);
  if (!phone || phone.length < 10) {
    console.error(`Nomor HP tidak valid: "${rawPhone}"`);
    process.exit(1);
  }

  const base: Omit<CustomerRow, "is_prorata" | "is_kompensasi"> = {
    no_hp: phone,
    nama: "Test Pelanggan",
    periode: "Agustus 2026",
    jatuh_tempo: "03 September 2026",
    tagihan: "165000",
  };

  const variants: { label: string; customer: CustomerRow }[] = [
    { label: "Normal", customer: { ...base, is_prorata: false, is_kompensasi: false } },
    { label: "Prorata", customer: { ...base, is_prorata: true, is_kompensasi: false } },
    { label: "Kompensasi", customer: { ...base, is_prorata: false, is_kompensasi: true } },
  ];

  console.log("🔄 Buka browser WhatsApp Web (pakai sesi login yang sama seperti daemon)...");
  const context = await chromium.launchPersistentContext("./session", { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://web.whatsapp.com");
  await waitForWhatsappReady(page);

  for (const { label, customer } of variants) {
    try {
      console.log(`📲 Kirim varian "${label}" ke ${phone}...`);
      await openAndSend(page, "billing", customer);
      // Tunggu sebentar sebelum lanjut ke pesan berikutnya (atau nutup
      // browser di akhir) -- kalau langsung nutup/lanjut habis Enter, ada
      // risiko WhatsApp belum sempat benar-benar kirim pesannya ke
      // server (pesan hilang, "terkirim" cuma klaim lokal). Daemon.ts
      // nggak kena ini karena context-nya nggak pernah ditutup per-pesan.
      await delay(3000);
      console.log(`✅ Varian "${label}" terkirim.`);
    } catch (err) {
      console.error(`❌ Gagal kirim varian "${label}":`, err);
      console.error(
        "   Kemungkinan selector compose box di openAndSend (lib/whatsapp.ts) sudah beda dari struktur WhatsApp Web saat ini."
      );
    }
  }

  console.log("🔥 Selesai. Cek WhatsApp di nomor tersebut.");
  await context.close();
}

main();
