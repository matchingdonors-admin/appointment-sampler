import sys
from playwright.sync_api import sync_playwright
URL = 'file://' + sys.argv[1]
res = []
def ok(name, cond, extra=''):
    res.append((bool(cond), name, extra)); print(('PASS' if cond else 'FAIL'), name, extra)

def fill(pg, zip_='07029', **kw):
    d = dict(fName='Ana', lName='Test', email='ana@example.com', phone='(555) 555-0123', street='1 Main St'); d.update(kw)
    for k, v in d.items(): pg.fill('#' + k, v)
    pg.fill('#zip', ''); pg.fill('#city', ''); pg.fill('#state', ''); pg.type('#zip', zip_)
submit = lambda pg: pg.click('#searchForm button[type=submit]')

with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 1200, 'height': 1000}); pg = ctx.new_page()
    errs, reqs = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    pg.on('request', lambda r: reqs.append(r.url) if not r.url.startswith('file:') else None)
    pg.goto(URL)

    # validation
    submit(pg); ok('empty form shows error', pg.locator('#zipErr').is_visible(), pg.locator('#zipErr').inner_text()[:50])
    fill(pg, email='bad'); submit(pg); ok('bad email rejected', 'email' in pg.locator('#zipErr').inner_text().lower())
    fill(pg, phone='123'); submit(pg); ok('short phone rejected', 'phone' in pg.locator('#zipErr').inner_text().lower())
    fill(pg, zip_='123'); pg.fill('#city', 'X'); pg.fill('#state', 'NJ'); submit(pg); ok('short ZIP rejected', '5-digit' in pg.locator('#zipErr').inner_text())
    fill(pg, zip_='00000'); pg.fill('#city', 'X'); pg.fill('#state', 'NJ'); submit(pg); ok('unknown ZIP rejected', "couldn't find" in pg.locator('#zipErr').inner_text())

    # autofill + local search
    fill(pg); ok('ZIP fills city/state', pg.input_value('#city') == 'Harrison' and pg.input_value('#state') == 'NJ', pg.input_value('#city'))
    submit(pg); pg.wait_for_selector('.card')
    n_all = pg.locator('.card').count(); ok('07029 returns cards', n_all >= 3, f'{n_all} cards | ' + pg.locator('.status h2').inner_text())
    ok('step 2 active', 'on' in pg.locator('#steps li').nth(1).get_attribute('class'))
    first = pg.locator('.card h3').first.inner_text(); pg.select_option('#sortSel', 'soon')
    ok('sort changes order', pg.locator('.card h3').first.inner_text() != first)
    pg.check('#newOnly'); submit(pg); ok('accepting-only filter drops waitlist pro', pg.locator('.card:has-text("Rachel Stein")').count() == 0)
    pg.uncheck('#newOnly'); pg.uncheck('#tele'); submit(pg); ok('video off removes video group', pg.locator('.group-h').count() == 0)
    pg.check('#tele'); pg.select_option('#spec', 'lawyer'); submit(pg)
    ok('type filter', all('Healthcare Lawyer' in t for t in pg.locator('.card .spec').all_inner_texts()) and pg.locator('.card').count() > 0, str(pg.locator('.card').count()))
    pg.select_option('#spec', '')

    # widened radius, video only, no match
    fill(pg, zip_='12205'); submit(pg); pg.wait_for_selector('.status')
    ok('radius widens with notice', pg.locator('.notice').count() >= 1 and pg.locator('.radius .hit').inner_text() != '10 mi', pg.locator('.radius .hit').inner_text())
    fill(pg, zip_='59001'); submit(pg); pg.wait_for_selector('.status')
    ok('video-only fallback', 'No ' in pg.locator('.status h2').inner_text() and pg.locator('.card').count() >= 1 and pg.locator('.notice.info').count() == 1)
    fill(pg, zip_='99950'); pg.select_option('#spec', 'lawyer'); submit(pg); pg.wait_for_selector('.empty')
    ok('no match shows notify', pg.locator('#notify').count() == 1)
    pg.click('#notify button'); ok('notify confirms', 'Thanks' in pg.locator('.empty').inner_text())
    pg.select_option('#spec', '')

    # talk now + schedule
    fill(pg); submit(pg); pg.wait_for_selector('.card')
    pg.locator('.nowbar [data-talk]').click()
    t = pg.locator('a[data-method=Tikr]')
    ok('talk now shows Tikr link', t.get_attribute('href').startswith('https://tikr.is/') and t.get_attribute('target') == '_blank', t.get_attribute('href'))
    ok('step 3 active', 'on' in pg.locator('#steps li').nth(2).get_attribute('class'))
    pg.evaluate("document.addEventListener('click',e=>{if(e.target.closest('a[data-method]'))e.preventDefault()},true)")
    t.click(); ok('steps complete after choosing', pg.locator('#steps li.done').count() == 3)
    pg.click('.seg button[data-mode=schedule]')
    c = pg.locator('a[data-method=Calendly]').get_attribute('href')
    ok('schedule shows prefilled Calendly', 'calendly.com' in c and 'name=Ana%20Test' in c and 'email=ana%40example.com' in c, c)
    ok('talk pane hidden on schedule tab', pg.locator('#talkPane').is_hidden())
    pg.click('#backBtn'); ok('back to results', pg.locator('#view-search').is_visible() and pg.locator('.card').count() == n_all)
    pg.locator('.card:not(:has(.live)) [data-pick]').first.click(); pg.click('.seg button[data-mode=talk]')
    ok('unavailable pro explains and offers others', "isn't available" in pg.locator('#talkPane').inner_text())
    pg.click('#backBtn'); pg.click('#helpMe'); ok('ask for help responds', 'Request noted' in pg.locator('#results').inner_text())

    # admin
    pg.click('details.admin summary')
    ok('admin lists 33 pros', pg.locator('#proRows tr').count() == 33)
    ok('connection logged with method', 'Tikr' in pg.locator('#connRows').inner_text() or 'Calendly' in pg.locator('#connRows').inner_text(), pg.locator('#connRows tr').first.inner_text().replace('\n', ' / ')[:110])
    ok('waitlist logged', '99950' in pg.locator('#waitRows').inner_text())
    row = pg.locator('#proRows tr:has-text("Fatima Haddad")'); row.locator('[data-flag=approved]').uncheck()
    ok('unapproved pro hidden from results', pg.locator('.card:has-text("Fatima Haddad")').count() == 0 and 'Not approved' in pg.locator('#proRows tr:has-text("Fatima Haddad")').inner_text())
    pg.locator('#proRows tr:has-text("Fatima Haddad") [data-flag=approved]').check()
    ok('re-approved pro returns', pg.locator('.card:has-text("Fatima Haddad")').count() == 1)
    pg.click('#addPro button[type=submit]'); ok('add: name required', 'name' in pg.locator('#addErr').inner_text().lower())
    pg.fill('#aName', 'Test <b>Pro</b>'); pg.fill('#aZip', '07029'); pg.fill('#aCal', 'calendly.com/x'); pg.click('#addPro button[type=submit]')
    ok('add: link must be https', 'https' in pg.locator('#addErr').inner_text())
    pg.fill('#aCal', 'https://calendly.com/matchingdonors/test'); pg.fill('#aTikr', 'https://tikr.is/test'); pg.select_option('#aSpec', 'dialysis'); pg.fill('#aBio', 'Bio'); pg.click('#addPro button[type=submit]')
    ok('added pro listed, hidden by default', pg.locator('#proRows tr').count() == 34 and pg.locator('.card:has-text("Test")').count() == 0)
    ok('markup in name is escaped', pg.locator('#proRows b').count() == 0)
    new = pg.locator('#proRows tr').last
    for k in ('license', 'approved', 'fee'): pg.locator('#proRows tr').last.locator(f'[data-flag={k}]').check()
    ok('added pro appears once all ticked', pg.locator('.card:has-text("Test")').count() == 1)

    # persistence + reset
    pg.reload(); pg.click('details.admin summary')
    ok('data survives reload', pg.locator('#proRows tr').count() == 34 and '99950' in pg.locator('#waitRows').inner_text())
    pg.click('#resetData'); pg.wait_for_load_state(); pg.click('details.admin summary')
    ok('reset restores sample data', pg.locator('#proRows tr').count() == 33 and 'No connections yet' in pg.locator('#connRows').inner_text())

    # injection via visitor fields
    fill(pg, fName='<img src=x onerror=window.__x=1>'); submit(pg); pg.wait_for_selector('.card'); pg.locator('[data-pick]').first.click()
    ok('visitor input is escaped', pg.evaluate('window.__x') is None and pg.locator('.booker img').count() == 0)

    # phone + dark
    m = ctx.new_page(); m.set_viewport_size({'width': 380, 'height': 800}); m.on('pageerror', lambda e: errs.append(str(e))); m.goto(URL)
    fill(m); submit(m); m.wait_for_selector('.card')
    ok('phone: no sideways scroll (results)', m.evaluate('document.documentElement.scrollWidth') <= 380, str(m.evaluate('document.documentElement.scrollWidth')))
    m.locator('[data-pick]').first.click(); ok('phone: no sideways scroll (scheduler)', m.evaluate('document.documentElement.scrollWidth') <= 380)
    m.click('details.admin summary'); ok('phone: no sideways scroll (admin)', m.evaluate('document.documentElement.scrollWidth') <= 380)
    m.screenshot(path='/home/claude/shots/e2e_phone.png')
    pg.evaluate("document.documentElement.dataset.theme='dark'"); pg.click('#backBtn'); pg.screenshot(path='/home/claude/shots/e2e_dark.png', full_page=True)

    hosts = sorted({u.split('/')[2] for u in reqs})
    ok('only font hosts are contacted', set(hosts) <= {'fonts.googleapis.com', 'fonts.gstatic.com'}, str(hosts))
    ok('no script errors', not errs, str(errs)[:300])
    b.close()
bad = [r for r in res if not r[0]]
print(f'\n{len(res) - len(bad)}/{len(res)} passed'); [print('FAILED:', r[1], r[2]) for r in bad]
