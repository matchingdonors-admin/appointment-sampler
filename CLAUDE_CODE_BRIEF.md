# MatchingDonors Appointment Finder: build brief

Read this first. It is the source of truth for the Phase 1 build.

## Goal

Turn the tested prototype (`index.html`) into a WordPress plugin that runs on the MatchingDonors sites. Visitors enter their details, find a professional near them, then talk now (Tikr) or schedule (Calendly). Staff manage professionals in the WordPress dashboard.

## Reference

- `index.html`, `css/styles.css`, `js/app.js` (repo root, also the hosted demo page): approved look and behaviour. Match it. Do not redesign, and do not move or rename these files.
- `js/providers.js` and `js/zip-data.js`: sample professionals and the ZIP table.
- `tests/e2e.py`: Playwright checks the prototype passes (42 of 42). Port these to run against the plugin page.
- The prototype keeps data in the browser. The plugin moves all of it to the server.

## Decisions already made

| Topic | Decision |
|---|---|
| Platform | WordPress plugin (confirmed by Paul) |
| Sites | MatchingDiabetes.com, DailyDiabetesNews, DailyTransplantNews, IrishDailyTransplantNews |
| Matching | Distance from the visitor's ZIP, widening 10, 25, 50, 100, 250 miles, then video appointments for professionals who serve the visitor's state |
| Appointment types | The six in the prototype |
| Talk now | Opens the professional's Tikr link. Tikr handles the paid call and pays the professional. We take no payments. |
| Schedule | Opens the professional's Calendly link (owned by MatchingDonors), with name and email prefilled. Used when the professional is not available now. |
| Emails | On every connection: confirmation to the visitor, the professional, and a MatchingDonors inbox. A test recipient can be added in settings. |
| Fees | Territory and professional fees are handled by Paul and Damon outside this system. Keep "fee paid" as a manual tick box only. |
| Data for now | Four imaginary professionals, clearly marked as samples |

## Scope: plugin `md-appointment-finder` (lives in `plugin/`)

**Professionals**
- Custom post type `md_professional`, managed in the dashboard.
- Fields: name, credentials, appointment type, practice, ZIP (lat/long filled on save), bio, languages, video appointments, states served, accepting new patients, Calendly link, Tikr link.
- Staff flags: license verified, approved, fee paid, active. A professional is shown only when all four are on.
- "Available now": a manual tick box on the professional for now (see open questions).

**Finder page**
- Shortcode `[md_appointment_finder site="MatchingDiabetes.com"]`. The `site` value is saved as the source on every record.
- Markup, CSS and client JS come from the prototype. Vanilla JS, no build step, no framework.
- Search runs on the server through a REST route. The ZIP table ships with the plugin as a data file and is never sent to the browser in full.
- Calendly: link with prefill, as in the prototype. Inline embed is a later improvement.

**Records** (custom tables)
- `leads`: visitor details and search (type, ZIP, source site).
- `connections`: created when a visitor opens a professional, before any link is shown; updated with the method chosen (Tikr or Calendly).
- `waitlist`: "Notify me" signups by ZIP and type.
- `help_requests`: "Ask for help" submissions.

**Emails** (`wp_mail`)
- Connection: visitor, professional, MatchingDonors inbox, optional test recipient.
- Notify me and Ask for help: MatchingDonors inbox, plus a receipt to the visitor.
- Recipients are settings, never hard-coded.

**Admin**
- List screens for leads, connections and waitlist, with CSV export. The connections export is what goes to Tikr's finance team until that process is defined.
- Settings: notification inbox, test recipient, radius steps.
- A WP-CLI command or activation step that seeds the four sample professionals.

## Out of scope

- Payments, fee collection, invoicing logic.
- Tikr API, Calendly webhooks, a fresh Tikr room per booking (rollout Phases 2 and 3).
- Professional self-service login.
- Privacy notice, consent wording and legal review: parked for now, too early in development.

## Privacy and security

- Nonce on every request, sanitize on input, escape on output, capability checks on admin screens.
- Honeypot field and basic rate limiting on the public routes.
- Visitor details are personal and health-related. Never write them to logs. Do not describe the system as HIPAA compliant.

## Code standards

- WordPress coding standards. Small files, one job each.
- No unnecessary code or dependencies. Do not add features that are not listed here.
- Comments short and sparse: say why, not what.
- Unit tests for the matching logic (distance, radius widening, state fallback, the four flags).

## Local setup

- Run WordPress locally (`wp-env` or Docker). Do not wait for access to the live site.
- Deliver an installable zip plus a short README for whoever installs it.

## Order of work

1. Plugin skeleton, post type, fields, seed data.
2. ZIP lookup and matching, with unit tests.
3. REST search route and the finder shortcode, matching the prototype.
4. Leads, connections and waitlist tables with the admin screens.
5. Emails and settings.
6. Port the end-to-end checks and run them.

## Open questions (do not block on these)

- WordPress admin access and hosting for the live sites.
- Are the four sites separate WordPress installs? Default: build for MatchingDiabetes.com first and keep data on one site.
- How professionals mark themselves "Available now". Default: staff tick box.
- What Tikr's finance team needs, in what format, and how often. Default: CSV export.
