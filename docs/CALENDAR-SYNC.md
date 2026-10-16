# Family calendar sync

Mi Casa does not store an Apple or Google password. The COO agent owns Family iCloud access and writes rows into `public.calendar_events_import`. The app only reads them.

Until those rows exist, Home shows the built-in holiday list and the line **Connect family calendar**. Do not invent family events. A concert, a festival, or a school date appears only when it is a real imported row.

## Table

`public.calendar_events_import`

| Column | Notes |
|---|---|
| `id` | uuid, default `gen_random_uuid()` |
| `household_id` | Johnson seed: `11111111-1111-4111-8111-111111111111` |
| `source` | text, e.g. `icloud-family` |
| `external_uid` | unique. Use the iCloud event UID so reruns upsert. |
| `title` | exact calendar title |
| `starts_at` / `ends_at` | `timestamptz` |
| `all_day` | boolean |
| `location` | text, nullable |
| `notes` | text, nullable |
| `imported_at` | set on every upsert |

The migration is `supabase/migrations/20261016040000_vnext_calendar_gifts_meals.sql`. Apply it in the Supabase SQL editor for project `tzkxuinbpmoeyhzomvut`. This repo does not apply it.

## Who can read and write

- **Service role** (COO, server-side only): insert and upsert. Never put the service role key in Vite, Vercel, or this repo.
- **Signed-in household members**: `SELECT` through RLS.
- **Anon**: no table grant. The anon key ships in the browser, so it cannot read the family calendar.

## Upsert

Run this with the service role, once per iCloud event. Replace the placeholders. Skip cancelled events and events you are not willing to show on the household desk.

```sql
INSERT INTO public.calendar_events_import (
  household_id,
  source,
  external_uid,
  title,
  starts_at,
  ends_at,
  all_day,
  location,
  notes
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'icloud-family',
  :external_uid,
  :title,
  :starts_at,
  :ends_at,
  :all_day,
  :location,
  :notes
)
ON CONFLICT (external_uid) DO UPDATE SET
  household_id = EXCLUDED.household_id,
  source = EXCLUDED.source,
  title = EXCLUDED.title,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  all_day = EXCLUDED.all_day,
  location = EXCLUDED.location,
  notes = EXCLUDED.notes,
  imported_at = now();
```

Delete a row when the iCloud event is deleted. Do not leave a stale title in the table.

```sql
DELETE FROM public.calendar_events_import
WHERE external_uid = :external_uid;
```

## What the app does with a row

Home merges upcoming import rows with the built-in US/Texas holiday list and shows the next 3–5. **Plan this** copies that title onto a draft household event with a short checklist. It does not invent a venue, a guest list, or a time that was not in the row.
