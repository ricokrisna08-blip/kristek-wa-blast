# kristek-wa-blast

Script Playwright buat kirim pesan WhatsApp (tagihan/marketing/apology) ke
Pelanggan KRISTEK lewat WhatsApp Web -- login sekali pakai QR, session-nya
ke-save lokal, terus bisa kirim pesan terprogram.

Ada 2 cara pakai:

1. **`npm start`** (CLI manual, seperti sebelumnya) -- baca data dari file
   Excel/CSV di folder `data/`, kamu jalanin sendiri kapan mau blast.
2. **`npm run daemon`** (baru) -- jalan terus di background, tarik data
   "Pelanggan belum bayar bulan ini" LANGSUNG dari Supabase (gak perlu
   export Excel manual lagi), bisa dipicu dari tombol "Blast Tagihan WA"
   di app KRISTEK (Pemilik), DAN otomatis jalan sendiri tiap tanggal 1 jam
   09:00.

## Setup awal (sekali saja)

```bash
npm install
npm run playwright:install
```

## Pakai CLI manual (`npm start`)

Tidak berubah dari sebelumnya:

```bash
npm start                # mode billing, baca data/billing_tagihan_KRISTEK.xlsx atau .csv
npm start marketing      # mode marketing, baca data/catering.xlsx atau .csv
npm start apology        # mode apology, baca data/apology.xlsx atau .csv
npm start -- --dry-run   # preview pesan tanpa benar-benar kirim
npm start -- --reset     # kirim ulang semua (abaikan progress sebelumnya)
```

## Pakai daemon (`npm run daemon`)

### 1. Bikin akun khusus "System WA Blast" (LANGSUNG DI SUPABASE)

Daemon ini butuh login ke Supabase buat baca data Pelanggan, role-nya harus
**Pemilik** biar bisa baca Pelanggan lintas Wilayah. **Jangan** pakai akun
pribadi kamu -- biar kalau kredensialnya bocor dari laptop, dampaknya
kecil. Role Pemilik **tidak bisa** dibuat lewat Kelola Akun di app (sengaja
dibatasi cuma Admin/Teknisi dari situ) -- harus 2 langkah manual di
Supabase Dashboard:

**a. Buat akun login-nya** (Authentication -> Users -> Add user):
- Email: `system-wa-blast@internal.kristek.app` (pola sama kayak akun lain
  di app: `<username>@internal.kristek.app`)
- Password: pilih sendiri, nanti dipakai buat `.env`
- Nyalakan toggle **"Auto Confirm User"** (biar gak perlu verifikasi email)
- Klik Create -> **copy User UID** yang muncul

**b. Buat baris profilnya** (SQL Editor -> New query, ganti `<UUID>` dengan
User UID dari langkah a):

```sql
insert into public.users (id, nama, alamat, no_telp, username, role, wilayah_id)
values (
  '<UUID>',
  'System WA Blast',
  '-',
  '-',
  'system-wa-blast',
  'pemilik',
  null
);
```

### 2. Isi `.env`

```bash
cp .env.example .env
```

Buka `.env`, isi:
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` -- sama seperti yang dipakai app
  KRISTEK (lihat `.env` di folder `kristek-app`).
- `WA_BLAST_ACCOUNT_EMAIL` / `WA_BLAST_ACCOUNT_PASSWORD` -- akun dari
  langkah 1.

### 3. Jalankan

```bash
npm run daemon
```

Browser Chrome bakal kebuka (scan QR kalau session-nya belum ada/expired),
lalu daemon mulai:
- **Polling** tabel `wa_blast_job` tiap 20 detik -- kalau ada job status
  `pending` (dibuat dari tombol "Blast Tagihan WA" di app), langsung
  diproses: tarik data Pelanggan `sudah_bayar_bulan_ini = false`, kirim
  satu-satu, update progress-nya biar keliatan live di app.
- **Jadwal otomatis**: tiap tanggal 1 jam 09:00, bikin job billing sendiri
  (skip kalau kebetulan masih ada job billing yang belum selesai).

Biarkan terminal ini tetap kebuka selama daemon mau jalan. Tekan `Ctrl+C`
buat berhenti (browser-nya ikut ketutup rapi).

### Biar tetap jalan walau terminal ditutup / laptop restart (opsional)

Daemon ini proses Node.js biasa, jadi bisa dijalankan pakai process
manager kayak [`pm2`](https://pmpm2.keymetrics.io/) atau macOS
**LaunchAgent** biar auto-start & auto-restart kalau crash. Ini pengaturan
level sistem (nyala terus di background) -- setup manual dulu kalau mau,
belum di-otomatisasi dari sini.

## Kenapa harus 2 jalur (CLI manual vs daemon)?

- Mode `billing` dari app **selalu** narik data langsung dari Supabase
  (real-time, gak perlu export manual) -- ini yang lewat daemon.
- Mode `marketing` (side-business sate, gak ada hubungannya sama data
  Pelanggan KRISTEK) dan `apology` (gangguan massal, isi pesannya beda
  tiap kejadian) masih manual lewat CLI + file Excel/CSV di `data/`,
  karena datanya emang gak datang dari tabel Pelanggan.

## Struktur

- `lib/whatsapp.ts` -- logic inti (build pesan, kirim, normalize nomor)
  dipakai bareng oleh `index.ts` dan `daemon.ts`.
- `lib/supabaseClient.ts` -- login daemon ke Supabase.
- `lib/fetchBillingFromSupabase.ts` -- query Pelanggan belum bayar.
- `index.ts` -- CLI manual (Excel/CSV).
- `daemon.ts` -- daemon (Supabase job queue + jadwal otomatis).
