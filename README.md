# GAgents

Aplikasi chat multi-agent dengan provider dan model yang dapat diatur per agent.

## Menjalankan

Butuh PostgreSQL yang berjalan. Koneksi diatur lewat `DATABASE_URL`, default:

```
postgres://postgres:postgres@127.0.0.1:5432/agent_chat
```

```bash
npm install
npm run dev
```

Web berjalan di `http://localhost:3000`, API di `http://localhost:4000`.

## Migrasi data dari SQLite

Kalau dulu pakai SQLite, jalankan sekali setelah API membuat tabel (start API
sekali atau `npm run db:migrate --workspace @agent-chat/api`):

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agent_chat \
  node scripts/migrate-sqlite-to-postgres.mjs
```

Aman dijalankan ulang — baris yang sudah ada dilewati.

## Struktur

- `apps/web`: UI chat dan sidebar agent
- `apps/api`: API Hono dan PostgreSQL (Drizzle ORM)
- `packages/shared`: schema dan tipe bersama

Kunci enkripsi disimpan di `apps/api/.data`.
