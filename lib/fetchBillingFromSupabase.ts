import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow } from "./whatsapp.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function currentPeriodeLabel(): string {
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function jatuhTempoLabel(): string {
  const now = new Date();
  return `06 ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

// Sama seperti getLaporanKeuangan.ts di app: "belum bayar bulan ini" itu
// sudah_bayar_bulan_ini = false pada tabel pelanggan. Pelanggan tanpa
// no_hp/harga sengaja tetap dimasukkan -- validasi & skip-nya sudah
// ditangani prepareCustomers() di lib/whatsapp.ts (dipakai bareng index.ts).
export async function fetchBillingFromSupabase(client: SupabaseClient): Promise<CustomerRow[]> {
  const { data, error } = await client
    .from("pelanggan")
    .select("nama, no_hp, harga")
    .eq("sudah_bayar_bulan_ini", false);

  if (error) {
    throw new Error(`Gagal ambil data Pelanggan belum bayar dari Supabase: ${error.message}`);
  }

  const periode = currentPeriodeLabel();
  const jatuhTempo = jatuhTempoLabel();

  return (data ?? []).map((row) => ({
    no_hp: row.no_hp ?? "",
    nama: row.nama ?? "",
    tagihan: String(row.harga ?? 0),
    periode,
    jatuh_tempo: jatuhTempo,
  }));
}
