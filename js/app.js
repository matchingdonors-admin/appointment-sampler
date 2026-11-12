/*
 * MatchingDonors appointment finder
 * Needs js/zip-data.js (ZIPDATA) and js/providers.js (PROVIDERS) loaded first.
 */
"use strict";

const SITE = "MatchingDiabetes.com";
const STORAGE_KEY = "md-finder-v1";
const RADII = [10, 25, 50, 100, 250]; // miles, tried in order

const SPECIALTIES = {
  transplant: "Organ Transplant Healthcare Professional",
  kidney: "Expert on Kidney Transplants",
  dialysis: "Dialysis Healthcare Professional",
  lawyer: "Healthcare Lawyer",
  patient: "Organ Transplant Patient",
  family: "Organ Transplant Patient Family Member",
};

// TODO: swap for a real availability toggle per professional
const AVAILABLE_NOW = new Set([2, 3, 8, 11, 14, 19, 22, 26, 28, 33]);

const DEFAULT_FLAGS = { license: true, approved: true, fee: true, active: true };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- storage ---------- */

// browser storage for now, this moves to the site database
const emptyStore = () => ({ flags: {}, extra: [], waitlist: [], connections: [] });

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyStore();
  } catch {
    return emptyStore();
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage blocked, keep going in memory
  }
}

const store = loadStore();
let lastSearch = null;
let visitor = null;
let selected = null;
let connection = null;

PROVIDERS.push(...store.extra);
PROVIDERS.forEach((p) => {
  p.tikrUrl = p.tikrUrl || "https://tikr.is/" + p.bookingUrl.split("/").pop();
});

/* ---------- helpers ---------- */

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => HTML_ENTITIES[ch]);

const firstName = (p) => p.name.split(" ")[0];
const fullTitle = (p) => esc(p.name) + (p.creds ? ", " + esc(p.creds) : "");
const round1 = (n) => Math.round(n * 10) / 10;

const initials = (name) =>
  name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("");

const flagsFor = (p) => ({ ...DEFAULT_FLAGS, ...store.flags[p.id] });
const isLive = (p) => Object.values(flagsFor(p)).every(Boolean);
const isAvailableNow = (p) => AVAILABLE_NOW.has(p.id);

const formatDay = (date) =>
  date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const formatStamp = (ms) =>
  new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// next weekday at least `days` from today
function nextOpening(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return date;
}

// haversine
function milesBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const h =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

// ZIPDATA.z rows are "zip,lat,lng,cityIndex"
const ZIPS = new Map(
  ZIPDATA.z.split(";").map((row) => {
    const [zip, lat, lng, city] = row.split(",");
    return [zip, { lat: +lat, lng: +lng, place: ZIPDATA.c[+city] }];
  }),
);

/* ---------- search ---------- */

const REQUIRED_FIELDS = [
  ["fName", "your first name"],
  ["lName", "your last name"],
  ["email", "your email"],
  ["phone", "your phone number"],
  ["street", "your street address"],
  ["zip", "your ZIP code"],
  ["city", "your city"],
  ["state", "your state"],
];

const markInvalid = (id) => $("#" + id).setAttribute("aria-invalid", "true");

function showFormError(message) {
  const box = $("#zipErr");
  box.textContent = message;
  box.hidden = false;
  $("#results").innerHTML = "";
}

function clearFormErrors() {
  $("#zipErr").hidden = true;
  $$("#searchForm [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

// returns an error message, or "" when the form is fine
function validateForm() {
  const missing = REQUIRED_FIELDS.filter(([id]) => !$("#" + id).value.trim());
  if (missing.length) {
    missing.forEach(([id]) => markInvalid(id));
    $("#" + missing[0][0]).focus();
    return "Please add " + missing.map(([, label]) => label).join(", ") + ".";
  }
  if (!$("#email").checkValidity()) {
    markInvalid("email");
    return "Check your email address, for example name@example.com.";
  }
  if ($("#phone").value.replace(/\D/g, "").length < 10) {
    markInvalid("phone");
    return "Enter a 10-digit phone number, including area code.";
  }
  if (!/^\d{5}$/.test($("#zip").value.trim())) {
    markInvalid("zip");
    return "Enter a 5-digit US ZIP code, for example 02134.";
  }
  return "";
}

function readVisitor() {
  const value = (id) => $("#" + id).value.trim();
  return {
    first: value("fName"),
    last: value("lName"),
    email: value("email"),
    phone: value("phone"),
    street: value("street"),
    city: value("city"),
    state: value("state").toUpperCase(),
    zip: value("zip"),
    pref: $("[name=pref]:checked").value,
  };
}

// nearest people first, widening the radius; then anyone who serves the state by video
function findMatches(loc, { spec, includeVideo, acceptingOnly }) {
  const state = loc.place.slice(-2);
  const pool = PROVIDERS.filter(
    (p) => isLive(p) && (!spec || p.specialty === spec) && (!acceptingOnly || p.accepting),
  ).map((p) => ({ ...p, d: milesBetween(loc.lat, loc.lng, p.lat, p.lng) }));

  let radius = null;
  let local = [];
  for (const r of RADII) {
    local = pool.filter((p) => p.d <= r);
    if (local.length) {
      radius = r;
      break;
    }
  }

  const localIds = new Set(local.map((p) => p.id));
  const remote = includeVideo
    ? pool.filter((p) => p.telehealth && p.licensed.includes(state) && !localIds.has(p.id))
    : [];

  return { state, radius, local, remote };
}

function runSearch() {
  clearFormErrors();
  const error = validateForm();
  if (error) return showFormError(error);

  const zip = $("#zip").value.trim();
  const loc = ZIPS.get(zip);
  if (!loc) {
    markInvalid("zip");
    return showFormError(`We couldn't find ZIP code ${zip}. Check the number and try again.`);
  }

  const spec = $("#spec").value;
  const matches = findMatches(loc, {
    spec,
    includeVideo: $("#tele").checked,
    acceptingOnly: $("#newOnly").checked,
  });

  visitor = readVisitor();
  lastSearch = { zip, place: loc.place, spec, ...matches };
  renderResults();
}

/* ---------- results ---------- */

function setStep(current) {
  $$("#steps li").forEach((li) => {
    const step = +li.dataset.s;
    li.className = step === current ? "on" : step < current ? "done" : "";
    li.querySelector("i").textContent = step < current ? "✓" : step;
  });
}

function completeSteps() {
  $$("#steps li").forEach((li) => {
    li.className = "done";
    li.querySelector("i").textContent = "✓";
  });
}

function distanceLabel(p, byVideo) {
  if (byVideo) return "Video";
  if (p.d < 1) return "&lt; 1 mi";
  return round1(p.d) + " mi";
}

function noticeBox(kind, html) {
  return `<div class="notice ${kind === "info" ? "info" : ""}">
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
      <rect x="9" y="5" width="2" height="7" rx="1"/>
      <rect x="9" y="13.5" width="2" height="2" rx="1"/>
    </svg>
    <div>${html}</div>
  </div>`;
}

function professionalCard(p, byVideo) {
  const available = isAvailableNow(p);
  const remoteAttr = byVideo ? 1 : "";

  const tags = [
    p.accepting
      ? '<span class="tag ok">Accepting new patients</span>'
      : '<span class="tag wait">Waitlist</span>',
    p.telehealth
      ? '<span class="tag tele">Video available</span>'
      : '<span class="tag">In person only</span>',
    ...p.languages.map((lang) => `<span class="tag">${esc(lang)}</span>`),
  ].join("");

  const status = available
    ? '<span class="live">Available now</span>'
    : `<div class="next">Next opening ${formatDay(nextOpening(p.nextDays))}</div>`;

  const talkButton = available
    ? `<button class="btn go" data-talk="${p.id}" data-remote="${remoteAttr}">Talk now</button>`
    : "";

  return `<article class="card">
    <div class="av" aria-hidden="true">${initials(p.name)}</div>
    <div style="min-width:0">
      <h3>${esc(p.name)}${p.creds ? `<small>, ${esc(p.creds)}</small>` : ""}</h3>
      <p class="spec">${SPECIALTIES[p.specialty]}</p>
      <div class="where">${esc(p.practice)} · ${esc(p.city)}, ${p.state}</div>
      <p class="bio">${esc(p.bio)}</p>
      <div class="tags">${tags}</div>
    </div>
    <div class="side">
      <div class="dist">${distanceLabel(p, byVideo)}<small>${byVideo ? "telehealth visit" : "from " + lastSearch.zip}</small></div>
      ${status}
      <div class="btns">
        ${talkButton}
        <button class="btn ${available ? "ghost" : ""}" data-pick="${p.id}" data-remote="${remoteAttr}">Schedule</button>
      </div>
    </div>
  </article>`;
}

function resultsHeading(sortBy) {
  const { place, local, spec } = lastSearch;
  const what = spec ? `matches for “${SPECIALTIES[spec]}”` : "professionals";
  const noun = local.length === 1 && !spec ? "professional" : what;
  const title = local.length
    ? `${local.length} ${noun} near ${esc(place)}`
    : `No ${what} within ${RADII.at(-1)} miles of ${esc(place)}`;

  const option = (value, label) =>
    `<option value="${value}"${sortBy === value ? " selected" : ""}>${label}</option>`;
  const sortControl =
    local.length > 1
      ? `<label class="sort" for="sortSel">Sort by
          <select id="sortSel">${option("near", "Nearest")}${option("soon", "Soonest opening")}</select>
        </label>`
      : "";

  return `<div class="status"><h2>${title}</h2>${sortControl}</div>`;
}

function radiusLadder(radius) {
  const steps = RADII.map((r) => {
    let state = "";
    if (radius === r) state = "hit";
    else if (radius === null || r < radius) state = "miss";
    return `<span class="r ${state}">${r} mi</span>`;
  }).join("");
  return `<div class="radius" aria-label="Search radius">Searched:&nbsp;${steps}</div>`;
}

function availableNowBar(online) {
  const first = online[0];
  const count = online.length === 1 ? "professional is" : "professionals are";
  const remoteAttr = lastSearch.local.includes(first) ? "" : 1;
  return `<div class="nowbar">
    <div><span class="live">Live</span>&nbsp; <b>${online.length} ${count} available to talk right now.</b> No appointment needed.</div>
    <button class="btn go" data-talk="${first.id}" data-remote="${remoteAttr}">Talk to the first available</button>
  </div>`;
}

function renderResults() {
  const { zip, radius, local, remote, state, spec } = lastSearch;
  const sortBy = $("#sortSel")?.value || "near";
  const bySoonest = (a, b) => a.nextDays - b.nextDays;
  local.sort(sortBy === "soon" ? bySoonest : (a, b) => a.d - b.d);
  remote.sort(bySoonest);

  let html = resultsHeading(sortBy);

  if (radius && radius > RADII[0]) {
    html += noticeBox(
      "warn",
      `Nobody is available within ${RADII[0]} miles of ${zip}, so we widened your search to <b>${radius} miles</b> to find the closest professionals.`,
    );
  }
  if (!local.length && remote.length) {
    html += noticeBox(
      "info",
      `There isn't anyone near you yet, but these professionals can meet with you by video and serve ${state}.`,
    );
  }

  const online = [...local, ...remote].filter(isAvailableNow);
  if (online.length) html += availableNowBar(online);

  html += radiusLadder(radius);

  if (local.length) {
    html += `<div class="list">${local.map((p) => professionalCard(p, false)).join("")}</div>`;
  }
  if (remote.length) {
    if (local.length) {
      html += `<h3 class="group-h">Also available by video in ${state}</h3>
        <p class="group-p">These professionals serve your state by secure video, so distance doesn't matter.</p>`;
    }
    html += `<div class="list">${remote.map((p) => professionalCard(p, true)).join("")}</div>`;
  }

  if (local.length || remote.length) {
    html += `<div class="empty" style="margin-top:18px">
      <p style="margin:0"><b style="color:var(--ink)">Not finding the right fit?</b> Tell us what you need near ${zip} and our team will help match you.
      <button class="chip" type="button" id="helpMe">Ask for help</button></p>
    </div>`;
  } else {
    const who = spec ? SPECIALTIES[spec].toLowerCase() : "professional";
    html += `<div class="empty">
      <h3>We're still growing our network near you</h3>
      <p style="margin:0">Leave your email and we'll let you know as soon as a ${who} joins near ${zip}. Requests like yours tell us where to recruit next.</p>
      <form id="notify"><button class="btn" type="submit">Notify me at ${esc(visitor.email)}</button></form>
    </div>`;
  }

  $("#results").innerHTML = html;
  setStep(2);
}

/* ---------- talk now / schedule ---------- */

const calendlyUrl = (p) =>
  p.bookingUrl +
  "?name=" +
  encodeURIComponent(visitor.first + " " + visitor.last) +
  "&email=" +
  encodeURIComponent(visitor.email);

// log the referral before any link is shown
function trackConnection(p) {
  connection = store.connections.find(
    (c) => c.pid === p.id && c.email === visitor.email && !c.method,
  );
  if (!connection) {
    connection = {
      ts: Date.now(),
      source: SITE,
      spec: p.specialty,
      zip: lastSearch.zip,
      pid: p.id,
      pro: p.name,
      visitor: visitor.first + " " + visitor.last,
      email: visitor.email,
      method: null,
    };
    store.connections.push(connection);
  }
  saveStore();
  renderAdmin();
}

function talkPanel(p) {
  const first = esc(firstName(p));

  if (isAvailableNow(p)) {
    return `<h2><span class="live">Available now</span><br>Talk with ${first} right now</h2>
      <p class="note" style="margin:6px 0 14px">No appointment needed. This is a paid video call through Tikr, billed by the minute.</p>
      <a class="btn go" data-method="Tikr" href="${esc(p.tikrUrl)}" target="_blank" rel="noopener" style="width:100%">Start paid video call</a>
      <p class="note">The call opens in Tikr. If ${first} is busy, come back here to choose someone else or schedule a time.</p>`;
  }

  // same specialty first
  const others = [...lastSearch.local, ...lastSearch.remote]
    .filter((o) => isAvailableNow(o) && o.id !== p.id)
    .sort((a, b) => (b.specialty === p.specialty) - (a.specialty === p.specialty))
    .slice(0, 3);

  const otherRows = others
    .map(
      (o) => `<div>
        <span><b style="color:var(--ink)">${esc(o.name)}</b><br><span class="note" style="margin:0">${SPECIALTIES[o.specialty]}</span></span>
        <button class="btn go" data-talk="${o.id}" data-remote="${lastSearch.local.includes(o) ? "" : 1}">Talk now</button>
      </div>`,
    )
    .join("");

  return `<h2>${first} isn't available right now</h2>
    <p class="note" style="margin:4px 0 0">Use “Schedule for later” to pick a time with ${first}${others.length ? ", or talk with someone who is available now:" : "."}</p>
    ${others.length ? `<div class="alt">${otherRows}</div>` : ""}`;
}

function schedulePanel(p) {
  const first = esc(firstName(p));
  return `<h2>Schedule a time with ${first}</h2>
    <p class="note" style="margin:0 0 14px">Scheduling is free. Pick a day and time on ${first}'s calendar.</p>
    <div class="booker">
      <b>Booking for ${esc(visitor.first)} ${esc(visitor.last)}</b>
      <span>${esc(visitor.email)} · ${esc(visitor.phone)}</span>
      <span>${esc(visitor.street)}, ${esc(visitor.city)}, ${esc(visitor.state)} ${esc(visitor.zip)}</span>
      <span>Prefers: ${esc(visitor.pref)}</span>
    </div>
    <a class="btn" data-method="Calendly" href="${esc(calendlyUrl(p))}" target="_blank" rel="noopener" style="width:100%">Open the calendar</a>
    <p class="note">Your name and email are filled in for you on the calendar page.</p>`;
}

function openProfessional(id, byVideo, tab = "schedule") {
  const match = [...lastSearch.local, ...lastSearch.remote].find((p) => p.id === id);
  selected = { ...match, remote: byVideo };
  const p = selected;
  trackConnection(p);

  const visit = byVideo ? "Telehealth (video)" : `In person, ${round1(p.d)} mi away`;

  $("#view-search").hidden = true;
  const view = $("#view-sched");
  view.hidden = false;
  view.innerHTML = `<div class="sched">
    <aside class="pane who">
      <div class="av" aria-hidden="true">${initials(p.name)}</div>
      <h2>${fullTitle(p)}</h2>
      <p class="spec" style="margin:0">${SPECIALTIES[p.specialty]}</p>
      <p style="margin:0;font-size:15px">${esc(p.bio)}</p>
      <dl>
        <dt>Visit</dt><dd>${visit}</dd>
        <dt>Where</dt><dd>${esc(p.practice)}<br>${esc(p.city)}, ${p.state} ${p.zip}</dd>
        <dt>Length</dt><dd>30 minutes</dd>
        <dt>Languages</dt><dd>${p.languages.join(", ")}</dd>
      </dl>
      <button class="back" id="backBtn">← Back to results</button>
    </aside>
    <div class="pane">
      <div class="seg" role="tablist">
        <button role="tab" data-mode="talk" aria-selected="${tab === "talk"}">Talk now</button>
        <button role="tab" data-mode="schedule" aria-selected="${tab === "schedule"}">Schedule for later</button>
      </div>
      <div id="talkPane" ${tab === "talk" ? "" : "hidden"}>${talkPanel(p)}</div>
      <div id="calPane" ${tab === "schedule" ? "" : "hidden"}>${schedulePanel(p)}</div>
    </div>
  </div>`;

  setStep(3);
  window.scrollTo({ top: $("#steps").offsetTop - 10, behavior: "smooth" });
}

function showTab(tab) {
  $$(".seg button").forEach((btn) =>
    btn.setAttribute("aria-selected", String(btn.dataset.mode === tab)),
  );
  $("#talkPane").hidden = tab !== "talk";
  $("#calPane").hidden = tab !== "schedule";
}

function backToResults() {
  $("#view-sched").hidden = true;
  $("#view-search").hidden = false;
  setStep(2);
}

/* ---------- admin ---------- */

function hiddenReason(flags) {
  if (!flags.license) return "License not verified";
  if (!flags.approved) return "Not approved";
  if (!flags.fee) return "Fee unpaid";
  if (!flags.active) return "Paused";
  return "";
}

function professionalRow(p) {
  const flags = flagsFor(p);
  const reason = hiddenReason(flags);
  const box = (key, label) =>
    `<td><input type="checkbox" data-flag="${key}" data-pid="${p.id}" ${flags[key] ? "checked" : ""} aria-label="${label} for ${esc(p.name)}"></td>`;

  return `<tr>
    <td>${fullTitle(p)}</td>
    <td>${SPECIALTIES[p.specialty]}</td>
    <td>${esc(p.city)}, ${esc(p.state)}</td>
    ${box("license", "License verified")}
    ${box("approved", "Approved")}
    ${box("fee", "Fee paid")}
    ${box("active", "Active")}
    <td><span class="tag ${reason ? "wait" : "ok"}">${reason || "Live"}</span></td>
  </tr>`;
}

function waitlistRows() {
  const groups = {};
  for (const entry of store.waitlist) {
    const key = entry.zip + "|" + (entry.spec || "");
    (groups[key] ||= []).push(entry.email);
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, emails]) => {
      const [zip, spec] = key.split("|");
      return `<tr>
        <td>${esc(zip)}</td>
        <td>${spec ? SPECIALTIES[spec] : "Any"}</td>
        <td>${emails.length}</td>
        <td>${emails.map(esc).join(", ")}</td>
      </tr>`;
    })
    .join("");
}

function connectionRows() {
  return [...store.connections]
    .reverse()
    .map(
      (c) => `<tr>
        <td>${formatStamp(c.ts)}</td>
        <td>${esc(c.source)}</td>
        <td>${esc(c.visitor)}<br>${esc(c.email)}</td>
        <td>${esc(c.zip)}</td>
        <td>${esc(c.pro)}<br>${SPECIALTIES[c.spec]}</td>
        <td>${c.method ? esc(c.method) : "Viewed, not chosen yet"}</td>
      </tr>`,
    )
    .join("");
}

function renderAdmin() {
  $("#proRows").innerHTML = PROVIDERS.map(professionalRow).join("");
  $("#waitRows").innerHTML = waitlistRows() || '<tr><td colspan="4">No signups yet.</td></tr>';
  $("#connRows").innerHTML =
    connectionRows() || '<tr><td colspan="6">No connections yet.</td></tr>';
}

function setFlag(id, key, value) {
  const p = PROVIDERS.find((x) => x.id === id);
  store.flags[p.id] = { ...flagsFor(p), [key]: value };
  saveStore();
  renderAdmin();
  if (lastSearch) runSearch();
}

function newProfessionalError(value, loc) {
  if (!value("aName")) return "Add the name.";
  if (!loc) return "Enter a valid 5-digit US ZIP code.";
  if (!/^https:\/\//.test(value("aCal"))) return "Add the Calendly link, starting with https://";
  if (!/^https:\/\//.test(value("aTikr"))) return "Add the Tikr link, starting with https://";
  return "";
}

function addProfessional() {
  const value = (id) => $("#" + id).value.trim();
  const loc = ZIPS.get(value("aZip"));

  const error = newProfessionalError(value, loc);
  $("#addErr").textContent = error;
  $("#addErr").hidden = !error;
  if (error) return;

  const [city, state] = loc.place.split(", ");
  const states = value("aStates")
    .toUpperCase()
    .split(/[\s,]+/)
    .filter(Boolean);

  const p = {
    id: Math.max(...PROVIDERS.map((x) => x.id)) + 1,
    name: value("aName"),
    creds: value("aCreds"),
    specialty: value("aSpec"),
    practice: value("aPractice"),
    city,
    state,
    zip: value("aZip"),
    lat: loc.lat,
    lng: loc.lng,
    telehealth: true,
    licensed: states.length ? states : [state],
    languages: ["English"],
    accepting: true,
    bio: value("aBio"),
    nextDays: 2,
    bookingUrl: value("aCal"),
    tikrUrl: value("aTikr"),
  };

  // hidden until staff tick the boxes
  store.flags[p.id] = { license: false, approved: false, fee: false, active: true };
  store.extra.push(p);
  PROVIDERS.push(p);
  saveStore();
  $("#addPro").reset();
  renderAdmin();
}

// the "how each professional is stored" table, using the first one as the example
function renderSchemaTable() {
  const ex = PROVIDERS[0];
  const rows = [
    ["Name & credentials", `${ex.name}, ${ex.creds}`, "Card heading"],
    [
      "Appointment type",
      SPECIALTIES[ex.specialty],
      "“Type of care” filter (the six options on your contact page)",
    ],
    [
      "Practice & address / ZIP",
      `${ex.practice}, ${ex.zip}`,
      "Location; lat/long filled in automatically on save",
    ],
    ["Short bio", ex.bio.slice(0, 60) + "…", "Card description"],
    [
      "Video appointments + states served",
      ex.licensed.join(", "),
      "Fallback when nobody is nearby (licensed or bar-admitted states for clinicians and lawyers)",
    ],
    ["Languages", ex.languages.join(", "), "Badges and future filter"],
    ["Accepting new patients", ex.accepting ? "Yes" : "No", "Badge and filter"],
    [
      "Booking link",
      `<code>${ex.bookingUrl}</code>`,
      "Step 3, “Schedule for later” (Calendly, owned by MatchingDonors)",
    ],
    ["Tikr link", `<code>${ex.tikrUrl}</code>`, "Step 3, paid “Talk now” call"],
    [
      "License verified, approved, fee paid",
      "Yes",
      "Ticked by staff; a profile shows only when all are ticked",
    ],
    ["Active", "On", "Pause someone without deleting them"],
  ];
  $("#schema").innerHTML = rows
    .map(([field, example, use]) => `<tr><td>${field}</td><td>${example}</td><td>${use}</td></tr>`)
    .join("");
}

function resetSampleData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
  location.reload();
}

/* ---------- events ---------- */

function joinWaitlist(form) {
  store.waitlist.push({
    ts: Date.now(),
    email: visitor.email,
    zip: lastSearch.zip,
    spec: lastSearch.spec,
    source: SITE,
  });
  saveStore();
  renderAdmin();
  form.outerHTML = `<p style="margin:0;color:var(--good)"><b>Thanks.</b> In the live version we'd email you when someone joins near ${lastSearch.zip}. (Demo: nothing was sent.)</p>`;
}

function requestHelp(button) {
  button.closest(".empty").innerHTML =
    `<p style="margin:0"><b style="color:var(--ink)">Request noted (demo).</b> On the live site this opens a short form that goes to your care-coordination inbox, tagged with ZIP ${lastSearch.zip}.</p>`;
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-method]");
  if (link && connection) {
    connection.method = link.dataset.method;
    saveStore();
    renderAdmin();
    completeSteps();
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.pick) openProfessional(+btn.dataset.pick, !!btn.dataset.remote);
  else if (btn.dataset.talk) openProfessional(+btn.dataset.talk, !!btn.dataset.remote, "talk");
  else if (btn.dataset.mode) showTab(btn.dataset.mode);
  else if (btn.id === "backBtn") backToResults();
  else if (btn.id === "helpMe") requestHelp(btn);
  else if (btn.id === "resetData") resetSampleData();
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "sortSel") renderResults();
  if (el.dataset.flag) setFlag(+el.dataset.pid, el.dataset.flag, el.checked);
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "searchForm") runSearch();
  else if (e.target.id === "notify") joinWaitlist(e.target);
  else if (e.target.id === "addPro") addProfessional();
});

// digits only, then fill city and state once we have a full ZIP
$("#zip").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5);
  const hit = ZIPS.get(e.target.value);
  if (!hit) return;
  const [city, state] = hit.place.split(", ");
  if (!$("#city").value) $("#city").value = city;
  if (!$("#state").value) $("#state").value = state;
});

/* ---------- init ---------- */

const specialtyOptions = Object.entries(SPECIALTIES)
  .map(([key, label]) => `<option value="${key}">${label}</option>`)
  .join("");
$("#spec").insertAdjacentHTML("beforeend", specialtyOptions);
$("#aSpec").innerHTML = specialtyOptions;

renderSchemaTable();
renderAdmin();
