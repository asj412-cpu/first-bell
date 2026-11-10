# At-home learning

Parent-led weekly practice in Mi Casa. The section is **Learning** in the House group (`/learning`, `/learning/:kidKey`). It is not a sixth phone tab. On a phone, this week’s card on Next up opens the child who has a seeded week.

Checkmarks are the parent “We did this” marks on weekday-plan rows. They are stored in `localStorage` key `first-bell.v1`. They do not score a “Got it” line and they do not write to school.

Cross-device sync uses `supabase/migrations/20261110120000_learning_progress.sql`. That file is additive and **not applied**. Until it is, checks stay on the device. If the table is missing while the rest of the household tables are live, the app keeps working and says so.

No text-to-speech. No new services.

## Add next Monday’s week

1. Copy the teacher’s Peek (and the UFLI Home Practice pages, if linked) into `src/data/learning/weeks/YYYY-MM-DD-<kidKey>.json`. `YYYY-MM-DD` is the Monday of that Peek week.
2. Import the file in `src/data/learning/index.js` and add it to the `WEEKS` array.
3. Rebuild. No other code change.

JSON is the source of truth. Do not fetch a Google Doc at runtime. Leave anything you invented labeled as an extra. Do not change a child’s grade in `src/data/profiles.js` from a week file.

## Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `YYYY-MM-DD-<kidKey>`, same stem as the file |
| `kidKey` | yes | `claire`, `chloe`, or `drew` |
| `weekStart` | yes | Monday, `YYYY-MM-DD` |
| `weekEnd` | yes | Last day the Next up card should show, inclusive |
| `title` | yes | Short week title |
| `teacher`, `school`, `peekLabel`, `summary` | yes | Shown on the week page |
| `focus.calloutLead`, `focus.lead`, `focus.body`, `focus.homeworkQuote`, `focus.standingRoutine` | yes | Friday-check callout, subjects, homework quote, binder routine |
| `focus.homeworkCite` | no | Quote attribution |
| `howTo.intro`, `howTo.bullets` | yes | 10–20 minutes, stop while it is going well |
| `planNote` | no | Caption under the weekday plan |
| `plan[]` | yes | `id`, `date`, `endDate`, `label`, `about`, `doTogether`, `activityIds` |
| `wordsNote`, `wordLists[]` | yes | Official UFLI rows: `lesson`, `sampleWords`, `chains`, `heartWords`, `sentences` |
| `activities[]` | yes | `id`, `number`, `title`, `goal`, `time`, `materials`, `steps[{title,detail}]`, `easier`, `harder`, `gotIt` |
| `extrasIntro`, `extras[{text,official}]` | yes | `official: false` keeps an extra labeled |
| `links[{title,site,href}]`, `sources[]` | yes | Teacher doc and UFLI links |

`plan[].id` is stable (`tue`, `sat-mon`). Progress is keyed by `kidKey` + `weekStart` + that id. A date range (`date` plus `endDate`) is one row and one checkbox. `activityIds` only link the plan to activity cards.

`gotIt` is instructions for the parent. It is not a checkbox.
