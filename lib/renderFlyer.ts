import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { BrowserContext } from "playwright";
import { formatRupiah, type CustomerRow } from "./whatsapp.js";

const TEMPLATE_PATH = resolve(process.cwd(), "templates", "flyer-tagihan.html");
const TMP_DIR = resolve(process.cwd(), "tmp");

// Sederhana: cukup {{PLACEHOLDER}} string-replace, bukan template engine
// beneran -- template-nya statis (dari desain HTML yang dikirim langsung),
// jadi nggak perlu lebih dari ini.
function fillTemplate(html: string, values: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

function tagRowHtml(c: CustomerRow): string {
  const tags: string[] = [];
  if (c.is_prorata) tags.push("Prorata");
  if (c.is_kompensasi) tags.push("Kompensasi Gangguan");
  if (tags.length === 0) return "";

  const badges = tags.map((t) => `<span class="tag-badge">${t}</span>`).join("");
  return `<div class="tag-row">${badges}</div>`;
}

// Render di TAB TERPISAH (bukan page WhatsApp Web yang lagi dipakai) --
// biar sesi WhatsApp Web yang aktif nggak ke-navigate pergi tiap kali mau
// bikin flyer. Tab render ditutup lagi setelah selesai.
//
// HTML dibaca dari disk sekali per panggilan (bukan cache) -- volumenya
// kecil (satu file per Pelanggan yang mau di-render), jadi nggak perlu
// dioptimalkan lebih jauh, dan langsung kepakai kalau template-nya
// diedit ulang tanpa restart daemon.
export async function renderFlyerBuffer(
  context: BrowserContext,
  c: CustomerRow
): Promise<Buffer> {
  const template = await readFile(TEMPLATE_PATH, "utf8");

  const html = fillTemplate(template, {
    NAMA: c.nama ?? "",
    PERIODE: c.periode ?? "",
    JATUH_TEMPO: c.jatuh_tempo ?? "",
    TAGIHAN: formatRupiah(c.tagihan),
    INVOICE_NO: c.invoice_no ?? "",
    TAG_ROW: tagRowHtml(c),
  });

  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    // Google Fonts dimuat async lewat <link> -- networkidle belum tentu
    // nunggu font selesai ke-apply, jadi tunggu sebentar lagi supaya
    // teks nggak kerender pakai fallback font di screenshot-nya.
    await page.waitForTimeout(400);

    return await page.locator(".flyer").screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

// Nama file ini yang bakal muncul ke pelanggan (dikirim sebagai Dokumen,
// bukan Foto & Video -- lihat openAndSendImage) -- jadi dibikin
// presentable, bukan cuma "flyer-<no_hp>.png".
function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// WhatsApp Web butuh path file buat upload (bukan Buffer langsung) --
// simpan sementara di ./tmp, satu file per nomor supaya panggilan
// paralel (kalau ada) nggak tabrakan.
export async function renderFlyerToTempFile(
  context: BrowserContext,
  c: CustomerRow
): Promise<string> {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  const buffer = await renderFlyerBuffer(context, c);
  const nama = slugify(c.nama || "Pelanggan");
  const periode = slugify(c.periode || "");
  const fileName = `Tagihan-KRISTEK-${nama}${periode ? `-${periode}` : ""}-${c.no_hp || Date.now()}.png`;
  const filePath = resolve(TMP_DIR, fileName);
  await writeFile(filePath, buffer);
  return filePath;
}
