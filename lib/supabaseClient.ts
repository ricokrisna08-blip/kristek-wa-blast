import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WA_BLAST_ACCOUNT_EMAIL = process.env.WA_BLAST_ACCOUNT_EMAIL;
const WA_BLAST_ACCOUNT_PASSWORD = process.env.WA_BLAST_ACCOUNT_PASSWORD;

export async function connectSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY belum diset di .env (lihat .env.example).");
  }
  if (!WA_BLAST_ACCOUNT_EMAIL || !WA_BLAST_ACCOUNT_PASSWORD) {
    throw new Error(
      "WA_BLAST_ACCOUNT_EMAIL / WA_BLAST_ACCOUNT_PASSWORD belum diset di .env -- bikin dulu akun " +
        '"System WA Blast" (role Pemilik) lewat Kelola Akun di app KRISTEK, lihat README.'
    );
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data, error } = await client.auth.signInWithPassword({
    email: WA_BLAST_ACCOUNT_EMAIL,
    password: WA_BLAST_ACCOUNT_PASSWORD,
  });

  if (error || !data.user) {
    throw new Error(`Gagal login ke Supabase sebagai daemon: ${error?.message ?? "unknown error"}`);
  }

  console.log(`✅ Login Supabase sebagai ${WA_BLAST_ACCOUNT_EMAIL} (user id: ${data.user.id})`);

  return { client, userId: data.user.id };
}
