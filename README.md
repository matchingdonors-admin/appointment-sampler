# Appointment Finder

Prototype of the MatchingDonors appointment finder: a visitor enters their details, finds a professional near their ZIP code, then talks now (Tikr) or schedules (Calendly).

It is a static page with sample professionals. Nothing is sent to a server; admin changes, the waitlist and the connections log are kept in the browser.

## Run it

Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000

## Layout

    index.html         page markup
    css/styles.css     styles (light and dark)
    js/app.js          search, results, scheduling, admin
    js/providers.js    sample professionals
    js/zip-data.js     US ZIP codes with coordinates
    tests/e2e.py       end-to-end checks

## Tests

    pip install playwright && playwright install chromium
    python3 tests/e2e.py "$(pwd)/index.html"

## Next

The production version is a WordPress plugin. See `CLAUDE_CODE_BRIEF.md`.
