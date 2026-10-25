# Deploy for free: Render (app) + Supabase (database + file storage)

Your designs and uploads live in Supabase, so Render restarting or sleeping never loses anything.
Free tiers: Supabase 500 MB database + 1 GB files; Render free web service (sleeps after ~15 min idle; first visit then takes ~30 s).

## 1. Supabase (5 min)
1. Create a free account and a **New project** at supabase.com. Save the database password somewhere.
2. Left menu **SQL Editor → New query**, paste the contents of `supabase-setup.sql`, click **Run**.
3. **Project Settings → API**: copy the **Project URL** and the **service_role** key (the secret one, never share it or put it in the browser).

## 2. GitHub
Create a new **private** repository and upload this folder (without `node_modules`; `.gitignore` already skips it).

## 3. Render (5 min)
1. render.com → **New → Web Service** → connect the GitHub repo.
2. Runtime **Node**, build command `npm install`, start command `npm start`, instance type **Free**.
3. Add environment variables:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_KEY` = the service_role key
   - `SECURE_COOKIES` = `1`
4. Deploy. Open your `https://….onrender.com` address, create the owner account, and build.
   Published pages are at `https://….onrender.com/p/your-address`.

## Notes
- Run only **one** instance (the free plan is one anyway): data is cached in memory and written to Supabase on every change.
- Keep-alive: to avoid the sleep delay for visitors, ping the site every ~10 min with a free uptime monitor (e.g. UptimeRobot).
- Backup: Supabase → Table Editor → `kv` row `main` holds all pages; files are in Storage → `assets`.
- Optional env: `USER_QUOTA_MB` (default 500 per user), `SUPABASE_BUCKET` (default `assets`).
