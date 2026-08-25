import type { Page } from "playwright";

export type CustomerRow = {
  no_hp: string;
  nama?: string;
  nama_catering?: string;
  tagihan?: string;
  is_prorata?: boolean;
  is_kompensasi?: boolean;
  periode?: string;
  jatuh_tempo?: string;
  invoice_no?: string;
};

export function normalizePhone(raw: string): string {
  let p = (raw || "").replace(/\D/g, "");

  if (!p) return "";
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;

  return p;
}

export function formatRupiah(val?: string): string {
  const num = Number(val || 0);
  return new Intl.NumberFormat("id-ID").format(num);
}

export function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomDelay(mode: string) {
  return mode === "marketing"
    ? Math.random() * 7000 + 8000 // lebih aman
    : Math.random() * 3000 + 3000;
}

export function prepareCustomers(rows: CustomerRow[]): CustomerRow[] {
  const seen = new Set<string>();
  const valid: CustomerRow[] = [];
  let skippedInvalid = 0;
  let skippedDupe = 0;

  for (const row of rows) {
    const phone = normalizePhone(row.no_hp);

    if (!phone || phone.length < 10) {
      skippedInvalid++;
      continue;
    }

    if (seen.has(phone)) {
      skippedDupe++;
      continue;
    }

    seen.add(phone);
    valid.push({ ...row, no_hp: phone });
  }

  if (skippedInvalid > 0) console.log(`⚠️  Skip ${skippedInvalid} baris: nomor HP kosong/invalid`);
  if (skippedDupe > 0) console.log(`⚠️  Skip ${skippedDupe} baris: nomor HP duplikat`);

  return valid;
}

export function buildBillingMessage(c: CustomerRow): string {
  const tags = [
    c.is_prorata ? "[Prorata]" : "",
    c.is_kompensasi ? "[Kompensasi Gangguan]" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const tagihanLabel = `Rp ${formatRupiah(c.tagihan)}${tags ? ` ${tags}` : ""}`;

  return `👋 Halo Ibu/Bpk ${c.nama}, Berikut rincian tagihan internet Anda untuk periode *${c.periode}*:

Pelanggan          : ${c.nama}
Tagihan              : ${tagihanLabel}
Periode               : ${c.periode}
Jatuh Tempo     : ${c.jatuh_tempo}

Pembayaran via:
- BCA                    : 5465080521 a/n Rico Trie Krisna
- DANA / GoPay   : 089699680859
- Cash            : Hubungi admin

Konfirmasi bukti transfer via WA: 08979749139

*Pesan ini dikirim otomatis oleh sistem KRISTEK.*

_*Notes_:
*Pemakaian akan diisolir sementara oleh provider jika belum ada pembayaran lebih dari tanggal 06 setiap bulannya.*

Powered by KRISTEK Wifi
#KoneksiCepat&Terpercaya`;
}

export function buildMarketingMessage(c: CustomerRow): string {
  return `Halo Bapak/Ibu ${c.nama_catering} 🙏

Perkenalkan, saya Sugiono, pemilik usaha supply sate yang berlokasi di :
Jl. Fatimah Bawah RT 04/RW 14, Kel. Kemiri Muka, Kec. Beji, Depok.

Kami menyediakan sate ayam dan kambing untuk kebutuhan catering dalam jumlah besar, dengan kualitas terjaga, rasa konsisten, dan harga yang kompetitif.

Kami siap menjadi partner supplier yang dapat diandalkan untuk mendukung kebutuhan produksi catering Bapak/Ibu.

Apabila berkenan, saya dapat mengirimkan informasi detail harga serta contoh produk.

Terima kasih atas perhatian Bapak/Ibu 🙏`;
}

export function buildApologyMessage(c: CustomerRow): string {
  return `Halo Ibu/Bpk ${c.nama},

Mohon maaf atas gangguan layanan masal yang terjadi saat ini.
Kami sedang berusaha keras agar layanan kembali normal. hal ini dikarenakan adanya gangguan pada jaringan provider yang kami gunakan.
perpindahan jalur dari udara ke jalur darat untuk sementara waktu menyebabkan gangguan yang tidak terduga.
kami berharap semoga besok sudah kembali lancar.

Terima kasih atas pengertian dan kesabaran Bapak/Ibu.

Salam,
Tim KRISTEK Wifi`;
}

export function buildMessage(mode: string, c: CustomerRow): string {
  if (mode === "marketing") return buildMarketingMessage(c);
  if (mode === "apology") return buildApologyMessage(c);
  return buildBillingMessage(c);
}

// Caption pendek yang nemenin gambar flyer -- ini teks ASLI (bukan
// bagian dari gambar), jadi pelanggan bisa tekan-lama lalu Copy nomor
// rekening/e-wallet-nya langsung dari sini, sama kayak nge-copy pesan WA
// biasa (gambar sendiri statis, nggak ada tombol yang bisa dipencet).
export function buildBillingCaption(c: CustomerRow): string {
  return `📋 Detail lengkap ada di gambar di atas.

💳 Nomor Pembayaran (tap & tahan untuk copy):
BCA: 5465080521 a/n Rico Trie Krisna
DANA/GoPay: 089699680859

Sudah transfer? Kirim bukti ke: 08979749139

Powered by KRISTEK Wifi`;
}

export async function waitForWhatsappReady(page: Page) {
  console.log("🔄 Tunggu WhatsApp login...");
  await page.waitForSelector("#pane-side", { timeout: 120000 });
  console.log("✅ WhatsApp siap!");
}

export async function openAndSend(page: Page, mode: string, c: CustomerRow) {
  const message = buildMessage(mode, c);
  const url = `https://web.whatsapp.com/send?phone=${c.no_hp}`;

  const compose = page.locator('div[contenteditable="true"][data-tab="10"]');

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await compose.waitFor({ timeout: 30000 });
  await delay(500);

  await compose.click();
  await page.keyboard.insertText(message);
  await delay(800);
  await page.keyboard.press("Enter");
}

// Kirim gambar (flyer) + caption teks ke satu nomor, sebagai DOKUMEN
// (bukan Foto & Video) -- WhatsApp cuma kompres ulang jadi JPEG kalau
// dikirim lewat Foto & Video (kualitas turun, teks jadi buram); lewat
// Dokumen filenya utuh apa adanya, walau konsekuensinya pelanggan harus
// tap dulu buat buka (nggak langsung tampil kayak foto biasa di chat).
//
// Selector-selector di bawah ini ngikutin struktur WhatsApp Web per saat
// ditulis -- WA sering ubah DOM-nya tanpa pemberitahuan, jadi kalau ini
// gagal di kemudian hari, itu tanda pertama yang perlu dicek adalah
// selector attach-menu/file-input/tombol-kirim-nya, BUKAN logic di
// sekitarnya. WAJIB dites manual dulu ke satu nomor sebelum dipakai
// blast massal.
export async function openAndSendImage(
  page: Page,
  phone: string,
  imagePath: string,
  caption: string
) {
  const url = `https://web.whatsapp.com/send?phone=${phone}`;
  const compose = page.locator('div[contenteditable="true"][data-tab="10"]');

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await compose.waitFor({ timeout: 30000 });
  await delay(500);

  // Buka menu lampiran -- ikon-nya "ic-attach-file" (dicek langsung di
  // WhatsApp Web, data-icon dipakai karena nggak bergantung bahasa UI,
  // beda dari aria-label "Lampirkan"/"Attach" yang berubah-ubah).
  await page.locator('[data-icon="ic-attach-file"]').first().click();
  await delay(300);

  // WhatsApp BARU bikin <input type="file"> begitu menu item "Dokumen"
  // itu sendiri diklik (sama kayak "Foto & Video" -- dicek langsung,
  // nggak ada input yang relevan sebelum item ini diklik) -- jadi HARUS
  // diklik betulan, bukan langsung cari input yang udah ada. Klik biasa
  // bakal munculin native OS file picker (yang nggak bisa diotomasi),
  // makanya pakai Playwright filechooser interception: event ini
  // nangkep dialog itu sebelum kebuka, kasih kita akses programatik ke
  // situ lewat setFiles().
  //
  // "Dokumen" ini nggak punya data-icon sendiri (dicek: aria-label +
  // teksnya sama persis "Dokumen", nggak ada ikon di dalam elemen
  // button-nya) -- makanya harus dicocokkan lewat nama, dengan fallback
  // bahasa Inggris kalau akun WhatsApp-nya diset non-Indonesia.
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    page.getByRole("menuitem", { name: /Dokumen|Document/i }).click(),
  ]);
  await fileChooser.setFiles(imagePath);

  // Modal preview gambar muncul, dengan kotak caption di bawahnya. Kotak
  // chat utama (juga contenteditable+data-tab="10") kemungkinan masih
  // ada di DOM di belakang modal ini -- pakai :visible + .last() (modal
  // biasanya di-append belakangan di DOM) supaya nggak ketimpa balik ke
  // kotak chat utama seperti bug file-input di atas.
  const captionBox = page
    .locator('div[contenteditable="true"][data-tab="10"]:visible, div[aria-label="Add a caption"]:visible')
    .last();
  await captionBox.waitFor({ timeout: 30000 });
  await delay(500);

  await captionBox.click();
  await page.keyboard.insertText(caption);
  await delay(500);

  const sendButton = page.locator('[data-icon="send"], [data-icon="wds-ic-send-filled"]').first();
  await sendButton.click();
  await delay(1000);
}
