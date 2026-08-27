import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow } from "./whatsapp.js";

// Nama bulan Indonesia -- pelanggan-nya orang Indonesia, jadi "Agustus"
// bukan "August" (sama seperti semua format tanggal id-ID di kristek-app).
function currentPeriodeLabel(): string {
  const now = new Date();
  return now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

// Jatuh tempo KRISTEK tanggal 3 tiap bulan (lihat mikrotik-daily-billing-cycle
// di kristek-app: "jatuh tempo tanggal 3, masa tenggang sampai tanggal 6,
// isolir kalau belum bayar per tanggal 7").
function jatuhTempoLabel(): string {
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth(), 3);
  return `03 ${dueDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}`;
}

// #INV-{bulan}{tahun}, mis. Agustus 2026 -> "082026".
function currentInvoiceNo(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
}

// Sama seperti getLaporanKeuangan.ts di app: "belum bayar bulan ini" itu
// sudah_bayar_bulan_ini = false pada tabel pelanggan. Pelanggan tanpa
// no_hp/harga sengaja tetap dimasukkan -- validasi & skip-nya sudah
// ditangani prepareCustomers() di lib/whatsapp.ts (dipakai bareng
// index.ts).
//
// tagihan_prorata: Pelanggan baru yang instalasinya di tengah siklus
// (lihat computeProrata.ts di kristek-app) punya tagihan bulan pertama
// yang lebih kecil dari harga normal -- kolom ini di-reset ke null
// otomatis setelah satu siklus lewat, jadi begitu null berarti tagih
// harga normal seperti biasa.
//
// Pelanggan Benefit (mis. RT/RW dapat internet gratis, harga = 0)
// TIDAK dikecualikan lewat flag is_benefit -- exclude-nya murni dari
// tagihan efektifnya 0/kosong. Kalau Pemilik ubah manual Harga
// Langganan Pelanggan Benefit itu jadi > 0 (mis. mau tetap ditagih
// sebagian), dia tetap kena blast seperti biasa.
//
// kompensasi_nominal: kompensasi gangguan layanan (lihat
// computeKompensasi.ts di kristek-app) -- dikurangkan dari tagihan bulan
// ini aja, ditandai "[Kompensasi Gangguan]" di pesan, lalu di-reset ke
// null otomatis di siklus berikutnya sama seperti tagihan_prorata.
//
// pelangganIds: kalau diisi (dipilih manual lewat picker "Pilih
// Pelanggan..." di WaBlastScreen), cuma ambil Pelanggan-Pelanggan itu --
// TANPA filter sudah_diblast_bulan_ini, karena pemilihan manual selalu
// dianggap resend eksplisit walau orangnya udah pernah dikirimin. Kalau
// kosong/null (blast-penuh, termasuk job dari cron bulanan di
// daemon.ts), tambah filter sudah_diblast_bulan_ini = false supaya
// nggak kirim dobel ke orang yang udah kekirim duluan (baik lewat
// manual maupun blast-penuh sebelumnya) di siklus yang sama.
export async function fetchBillingFromSupabase(
  client: SupabaseClient,
  pelangganIds?: string[] | null
): Promise<CustomerRow[]> {
  let query = client
    .from("pelanggan")
    .select("id, nama, no_hp, harga, tagihan_prorata, kompensasi_nominal")
    .eq("sudah_bayar_bulan_ini", false);

  if (pelangganIds && pelangganIds.length > 0) {
    query = query.in("id", pelangganIds);
  } else {
    query = query.eq("sudah_diblast_bulan_ini", false);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Gagal ambil data Pelanggan belum bayar dari Supabase: ${error.message}`);
  }

  const periode = currentPeriodeLabel();
  const jatuhTempo = jatuhTempoLabel();
  const invoiceNo = currentInvoiceNo();

  return (data ?? [])
    .map((row) => {
      const dasar = row.tagihan_prorata ?? row.harga ?? 0;
      const kompensasi = row.kompensasi_nominal ?? 0;
      const tagihanAngka = Math.max(dasar - kompensasi, 0);
      return {
        id: row.id,
        no_hp: row.no_hp ?? "",
        nama: row.nama ?? "",
        tagihan: String(tagihanAngka),
        tagihanAngka,
        is_prorata: row.tagihan_prorata != null,
        is_kompensasi: row.kompensasi_nominal != null,
        periode,
        jatuh_tempo: jatuhTempo,
        invoice_no: invoiceNo,
      };
    })
    .filter((row) => row.tagihanAngka > 0)
    .map(({ tagihanAngka, ...row }) => row);
}
