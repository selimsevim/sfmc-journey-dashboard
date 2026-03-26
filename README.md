# Journey Dashboard

A self-hosted analytics dashboard for Salesforce Marketing Cloud (SFMC) Journey Builder. Visualises email engagement, deliverability, link performance, and per-journey metrics from CSV data exports, with optional live enrichment from the SFMC Journey Builder API.

---

## Features

- **Dashboard** — Journey Flow KPIs (Total Journeys, Active Journeys, Unique Entries, Completion Rate), Engagement KPIs (Open Rate, Click Rate, CTOR, Bounce Rate, Unsubscribe Rate), trend chart, quick diagnostics, and a ranked journey list with per-journey conversion, entries, live population, and modified date.
- **Journey Detail** — Per-step breakdown with open rate, click rate, and CTOR for each email step.
- **Deliverability** — Hard/soft/unknown bounce KPIs, trend chart, donut by category, top bounce reasons, and SMTP code breakdown.
- **Link Analytics** — Top-10 link bar chart, 7×24 engagement heatmap, and a full link table.
- **Settings** — Brand name, colour palette, and threshold configuration persisted to `localStorage`. Live preview panel.
- **SFMC Live Enrichment** — One-time API call on server startup fetches current population, modified date, and journey status from SFMC Journey Builder and merges them into dashboard data.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Server | Node.js + Express 5 |
| Data | CSV files parsed into memory at startup via `csv-parser` |
| Frontend | Vanilla JS + Tailwind CSS (CDN) + Chart.js 4 |
| SFMC API | OAuth2 `client_credentials` via `axios` |
| Font | Manrope (Google Fonts) |

No build step. No frontend framework. No database.

---

## Project Structure

```
journeydashboard/
├── server.js                    # Express app, routes, SFMC startup cache
├── package.json
├── .env                         # SFMC credentials (not committed)
├── .env.example                 # Credential template
│
├── src/api/
│   ├── csvService.js            # Loads all CSVs, computes all metrics
│   └── sfmcJourneyService.js    # SFMC OAuth2 + Journey Builder API
│
├── public/
│   ├── index.html               # Main dashboard
│   ├── journey.html             # Journey detail page
│   ├── bounces.html             # Deliverability page
│   ├── links.html               # Link analytics page
│   ├── settings.html            # Settings page
│   └── js/
│       ├── config.js            # Runtime theme + threshold config
│       ├── app.js               # Dashboard logic and chart rendering
│       └── journey.js           # Journey detail logic
│
└── data/
    ├── Journey_History.csv      # Journey execution history (required)
    ├── Journey_Send.csv         # Journey entry / send events (required)
    ├── Opens.csv                # Open events (required)
    ├── Clicks.csv               # Click events (required)
    ├── Bounces.csv              # Bounce events (required)
    ├── Unsubscribes.csv         # Unsubscribe events (required)
    └── sfmc-journeys.csv        # Written by SFMC API on startup (auto-generated)
```

---

## Data Files

Place your SFMC CSV exports in the `data/` directory.

| File | Source in SFMC | Key columns used |
|---|---|---|
| `Journey_History.csv` | Journey Builder — [Download Journey History API](https://developer.salesforce.com/docs/marketing/marketing-cloud/references/mc_rest_interaction/downloadJourneyHistory.html) | `DefinitionId`, `DefinitionName`, `ContactKey`, `Status`, `ActivityId`, `ActivityType`, `TransactionTime` |
| `Journey_Send.csv` | Journey entry / send data extension | `JourneyID`, `VersionID`, `VersionNumber`, `ActivityID`, `ActivityName`, `TriggererSendDefinitionObjectID`, `SubscriberKey` |
| `Opens.csv` | Email Studio opens | `SubscriberKey`, `EventDate` |
| `Clicks.csv` | Email Studio clicks | `SubscriberKey`, `EventDate`, `URL`, `LinkName`, `TriggererSendDefinitionObjectID` |
| `Bounces.csv` | Email Studio bounces | `SubscriberKey`, `EventDate`, `BounceCategory`, `SMTPCode` |
| `Unsubscribes.csv` | Email Studio unsubscribes | `SubscriberKey`, `EventDate` |

`sfmc-journeys.csv` is generated automatically when the server starts with valid SFMC credentials. It should not be edited manually.

### Exporting Journey_History.csv

Use the [Download Journey History](https://developer.salesforce.com/docs/marketing/marketing-cloud/references/mc_rest_interaction/downloadJourneyHistory.html) REST endpoint:

```
POST /interaction/v1/interactions/journeyhistory/download
```

Required header: `x-direct-pipe: true`. The response streams a CSV file directly.

Recommended request body to capture all activity types:

```json
{
  "start": "2024-01-01T00:00:00Z",
  "end": "2026-12-31T23:59:59Z"
}
```

Default columns exported: `TransactionTime`, `ContactKey`, `Status`, `DefinitionId`, `DefinitionName`, `ActivityId`, `ActivityName`, `ActivityType`. Additional columns can be requested via the `columns` query parameter. Note: SFMC retains journey history data for **30 days** — export regularly to avoid gaps.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Place CSV data files

Copy your SFMC exports into the `data/` directory using the exact filenames listed above.

### 3. Configure environment (optional — SFMC live enrichment)

Copy `.env.example` to `.env` and fill in your SFMC credentials:

```
SFMC_AUTH_BASE_URL=https://YOUR_SUBDOMAIN.auth.marketingcloudapis.com
SFMC_CLIENT_ID=YOUR_CLIENT_ID
SFMC_CLIENT_SECRET=YOUR_CLIENT_SECRET
SFMC_ACCOUNT_ID=YOUR_MID
```

If `.env` is absent or credentials are not set, the dashboard runs in CSV-only mode. All metrics still work; live population counts and modified dates reflect whatever is already in `data/sfmc-journeys.csv`.

### 4. Start the server

```bash
npm start
```

The server loads all CSVs into memory, then (if SFMC is configured) makes a single call to the Journey Builder API, writes `data/sfmc-journeys.csv`, and is ready. No further API calls are made during normal operation.

Open `http://localhost:3000`.

---

## SFMC Integration

When SFMC credentials are provided, the server performs **one API call at startup** using the [Get Interaction Collection](https://developer.salesforce.com/docs/marketing/marketing-cloud/references/mc_rest_interaction/getInteractionCollection.html) endpoint:

```
GET /interaction/v1/interactions
```

Required scope: `Automation | Journeys | Read`.

The call is paginated (`$pageSize: 50`, `mostRecentVersionOnly: true`) with `extras=stats` to include current population counts. It:

1. Fetches all journeys across all pages
2. Writes `data/sfmc-journeys.csv` with columns: `id`, `Journey name`, `Population`, `modifiedDate`, `status`
3. Reloads the in-memory lookup so each journey in the list shows its live population and last modified date

The `id` field in `sfmc-journeys.csv` is the SFMC journey definition ID returned by the API. It is matched against `DefinitionId` / `VersionID` from the CSV exports using a `JourneyID → VersionID` translation map built from `Journey_Send.csv`, so the join works regardless of which UUID variant the API returns.

Possible `status` values from the API: `Draft`, `Published`, `Paused`, `Stopped`, `ScheduledToPublish`, `Unpublished`, `Deleted`. The dashboard counts journeys with `status = Published` as **Active Journeys**.

---

## Key Metrics Explained

| Metric | Definition |
|---|---|
| **Conversion Rate** | Completed contacts ÷ (completed + failed) contacts, per journey |
| **Completion Rate** (flow KPI) | Same calculation aggregated across all journeys |
| **Open Rate** | Unique openers ÷ journey population |
| **Click Rate** | Unique clickers ÷ journey population |
| **CTOR** | Unique clickers ÷ unique openers |
| **Bounce Rate** | Bounced contacts ÷ journey population |
| **Total Journeys** | Total rows in `sfmc-journeys.csv` |
| **Active Journeys** | Rows in `sfmc-journeys.csv` where `status = Published` |
| **Multi-Step** | Journey with more than one distinct email `ActivityId` |
| **One-Off** | Journey with exactly one email `ActivityId` |

---

## Settings & Theming

Navigate to `/settings` to customise:

- **Brand name** — displayed in the nav logo
- **Colours** — primary (coral), secondary (teal), tertiary (amber) with live hex input and colour picker
- **Thresholds** — good/warn cutoffs for Open Rate, Click Rate, CTOR, and Completion Rate; controls green/amber/red colouring throughout the dashboard

Changes are saved to `localStorage` and applied on reload. Reset restores all defaults.

---

## Design System

The UI follows the **"Analytical Architect"** design language documented in `ui/teal_insight/DESIGN.md`:

- **Font** — Manrope (400–800)
- **Primary** — Coral `#f64d50`
- **Secondary** — Teal `#006a62`
- **No 1px borders** — section separation uses background colour shifts and whitespace only
- **Surface layering** — `surface` → `surface-container-low` → `surface-container-lowest` for depth
- **Roundness** — `rounded-lg` (8px) throughout

---

## Port

Default: `3000`. Override with the `PORT` environment variable.
