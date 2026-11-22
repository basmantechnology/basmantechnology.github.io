/**
 * BasMan Technology — External Job Fetcher
 * -----------------------------------------
 * Add this as a NEW file (JobFetcher.gs) in the same Apps Script project as Code.gs.
 * It does not change Code.gs. It creates/uses these tabs in your sheet:
 *   • "Job Sources"   – what to search for (you fill this in)
 *   • "External Jobs" – fetched jobs waiting for your review
 *
 * Sources: Adzuna, Jooble, Careerjet (keyword + city search),
 *          Greenhouse, Lever (company career pages),
 *          Remotive, RemoteOK (remote jobs).
 *
 * API keys go in ⚙ Project Settings → Script Properties:
 *   ADZUNA_APP_ID, ADZUNA_APP_KEY   (free: https://developer.adzuna.com)
 *   JOOBLE_KEY                      (free on request: https://in.jooble.org/api/about)
 *   CAREERJET_KEY                   (free publisher key: careerjet partners page)
 * Any source with no key is simply skipped.
 */

// ===================== SETTINGS =====================
var FETCH = {
  SOURCES_TAB: 'Job Sources',
  EXTERNAL_TAB: 'External Jobs',
  JOBS_TAB: 'Jobs',              // your existing Jobs tab (used only by publishApprovedExternal)
  FETCH_HOUR: 7,                 // runs daily at ~7:00, before your 8:00 daily tasks
  MAX_AGE_DAYS: 3,               // ignore jobs older than this
  PER_SEARCH: 20,                // max jobs per keyword/city per source
  DESCRIPTION_CHARS: 600,        // trim long descriptions
  JOOBLE_HOST: 'in.jooble.org',  // Jooble India
  CAREERJET_LOCALE: 'en_IN',     // Careerjet India
  ADZUNA_COUNTRY: 'in',          // Adzuna India
  // For company feeds (Greenhouse/Lever): keep only jobs whose location contains one of these
  // words, or one of your cities from the Job Sources tab. Set to [] to keep all locations.
  COMPANY_LOCATION_FILTER: ['india', 'remote']
};

var EXTERNAL_HEADERS = ['Status', 'Source', 'Title', 'Company', 'Location', 'Salary',
  'Job Type', 'Posted', 'Description', 'Apply Link', 'Job Key', 'Fetched At'];

// ===================== MAIN =====================

/** Run once: creates the tabs and the daily 7:00 trigger. */
function setupJobFetcher() {
  getSourcesSheet_();
  getExternalSheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fetchExternalJobs') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fetchExternalJobs').timeBased().everyDays(1).atHour(FETCH.FETCH_HOUR).create();
  Logger.log('Job fetcher set up. Fill in the "Job Sources" tab, then run fetchExternalJobs to test.');
}

/** Fetches new jobs from all sources and adds them to "External Jobs" with Status = New. */
function fetchExternalJobs() {
  var sources = readSources_();
  var props = PropertiesService.getScriptProperties();
  var keys = {
    adzunaId: props.getProperty('ADZUNA_APP_ID'),
    adzunaKey: props.getProperty('ADZUNA_APP_KEY'),
    jooble: props.getProperty('JOOBLE_KEY'),
    careerjet: props.getProperty('CAREERJET_KEY')
  };

  var found = [];
  var log = [];
  function run(label, fn) {
    try {
      var jobs = fn() || [];
      found = found.concat(jobs);
      log.push(label + ': ' + jobs.length);
    } catch (e) {
      log.push(label + ': ERROR ' + e.message);
    }
  }

  sources.searches.forEach(function (s) {
    var tag = ' [' + s.keyword + (s.city ? ' / ' + s.city : '') + ']';
    if (keys.adzunaId && keys.adzunaKey) run('Adzuna' + tag, function () { return fetchAdzuna_(s, keys); });
    if (keys.jooble) run('Jooble' + tag, function () { return fetchJooble_(s, keys); });
    if (keys.careerjet) run('Careerjet' + tag, function () { return fetchCareerjet_(s, keys); });
  });

  var cityWords = sources.searches.map(function (s) { return (s.city || '').toLowerCase(); })
    .filter(String);
  sources.greenhouse.forEach(function (c) {
    run('Greenhouse [' + c + ']', function () { return fetchGreenhouse_(c, cityWords); });
  });
  sources.lever.forEach(function (c) {
    run('Lever [' + c + ']', function () { return fetchLever_(c, cityWords); });
  });

  if (sources.remote.length) {
    sources.remote.forEach(function (k) {
      run('Remotive [' + k + ']', function () { return fetchRemotive_(k); });
    });
    run('RemoteOK', function () { return fetchRemoteOK_(sources.remote); });
  }

  var added = saveNewJobs_(found);
  var summary = 'Fetched ' + found.length + ', added ' + added + ' new.\n' + log.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * Copies rows you marked "Approve" in "External Jobs" into your Jobs tab, matching columns
 * by header name. Unmatched columns are left blank. Approved rows become "Published".
 */
function publishApprovedExternal() {
  var ext = getExternalSheet_();
  var jobsSheet = SpreadsheetApp.getActive().getSheetByName(FETCH.JOBS_TAB);
  if (!jobsSheet) throw new Error('Tab "' + FETCH.JOBS_TAB + '" not found.');

  var jobHeaders = jobsSheet.getRange(1, 1, 1, jobsSheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  var synonyms = {
    id: ['id', 'job id'],
    title: ['title', 'job title', 'role', 'position', 'designation'],
    company: ['company', 'company name', 'employer'],
    location: ['location', 'city', 'job location'],
    salary: ['salary', 'ctc', 'package', 'pay'],
    type: ['type', 'job type', 'employment type'],
    description: ['description', 'job description', 'details', 'jd'],
    apply: ['apply link', 'apply url', 'link', 'url', 'apply', 'how to apply'],
    source: ['source'],
    posted: ['posted', 'posted on', 'date', 'created', 'created at'],
    status: ['status']
  };
  function col(field) {
    var list = synonyms[field];
    for (var i = 0; i < list.length; i++) {
      var idx = jobHeaders.indexOf(list[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  var data = ext.getDataRange().getValues();
  var h = data[0];
  var c = {};
  h.forEach(function (name, i) { c[name] = i; });
  var published = 0;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (String(row[c['Status']]).trim().toLowerCase() !== 'approve') continue;
    var out = new Array(jobHeaders.length).fill('');
    var put = function (field, value) { var i = col(field); if (i !== -1) out[i] = value; };
    put('id', 'EXT-' + shortHash_(row[c['Job Key']]));
    put('title', row[c['Title']]);
    put('company', row[c['Company']]);
    put('location', row[c['Location']]);
    put('salary', row[c['Salary']]);
    put('type', row[c['Job Type']]);
    put('description', row[c['Description']] + '\n\nSource: ' + row[c['Source']]);
    put('apply', row[c['Apply Link']]);
    put('source', row[c['Source']]);
    put('posted', new Date());
    put('status', 'Open');
    jobsSheet.appendRow(out);
    ext.getRange(r + 1, c['Status'] + 1).setValue('Published');
    published++;
  }
  Logger.log('Published ' + published + ' job(s) to ' + FETCH.JOBS_TAB + '.');
  return published;
}

// ===================== SOURCES =====================

function fetchAdzuna_(s, keys) {
  var url = 'https://api.adzuna.com/v1/api/jobs/' + FETCH.ADZUNA_COUNTRY + '/search/1' +
    '?app_id=' + encodeURIComponent(keys.adzunaId) +
    '&app_key=' + encodeURIComponent(keys.adzunaKey) +
    '&results_per_page=' + FETCH.PER_SEARCH +
    '&what=' + encodeURIComponent(s.keyword) +
    (s.city ? '&where=' + encodeURIComponent(s.city) : '') +
    '&max_days_old=' + FETCH.MAX_AGE_DAYS +
    '&sort_by=date&content-type=application/json';
  var json = getJson_(url);
  return (json.results || []).map(function (j) {
    return job_('Adzuna', j.id, j.title, j.company && j.company.display_name,
      j.location && j.location.display_name,
      salaryText_(j.salary_min, j.salary_max, 'INR', 'year'),
      [j.contract_type, j.contract_time].filter(Boolean).join(', '),
      j.created, j.description, j.redirect_url);
  });
}

function fetchJooble_(s, keys) {
  var res = UrlFetchApp.fetch('https://' + FETCH.JOOBLE_HOST + '/api/' + encodeURIComponent(keys.jooble), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ keywords: s.keyword, location: s.city || '', page: '1' }),
    muteHttpExceptions: true
  });
  var json = parseResponse_(res);
  return (json.jobs || []).slice(0, FETCH.PER_SEARCH).map(function (j) {
    return job_('Jooble', j.id, j.title, j.company, j.location, j.salary, j.type,
      j.updated, j.snippet, j.link);
  });
}

function fetchCareerjet_(s, keys) {
  // Careerjet requires user_ip and user_agent. This is a server-side daily fetch with no
  // end user, so we send your script's identity. Check Careerjet's terms for batch use.
  var url = 'https://search.api.careerjet.net/v4/query' +
    '?locale_code=' + FETCH.CAREERJET_LOCALE +
    '&keywords=' + encodeURIComponent(s.keyword) +
    (s.city ? '&location=' + encodeURIComponent(s.city) : '') +
    '&sort=date&page_size=' + FETCH.PER_SEARCH + '&fragment_size=' + FETCH.DESCRIPTION_CHARS +
    '&user_ip=0.0.0.0&user_agent=' + encodeURIComponent('BasManJobFetcher/1.0 (Google Apps Script)');
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(keys.careerjet + ':') },
    muteHttpExceptions: true
  });
  var json = parseResponse_(res);
  return (json.jobs || []).map(function (j) {
    var salary = j.salary || salaryText_(j.salary_min, j.salary_max, j.salary_currency_code,
      { Y: 'year', M: 'month', W: 'week', D: 'day', H: 'hour' }[j.salary_type] || '');
    return job_('Careerjet', j.url, j.title, j.company, j.locations, salary, '',
      j.date, j.description, j.url);
  });
}

function fetchGreenhouse_(company, cityWords) {
  var json = getJson_('https://boards-api.greenhouse.io/v1/boards/' +
    encodeURIComponent(company) + '/jobs?content=true');
  return (json.jobs || [])
    .filter(function (j) { return locationOk_(j.location && j.location.name, cityWords); })
    .map(function (j) {
      return job_('Greenhouse', company + '-' + j.id, j.title, companyName_(company),
        j.location && j.location.name, '', '', j.updated_at, j.content, j.absolute_url);
    });
}

function fetchLever_(company, cityWords) {
  var json = getJson_('https://api.lever.co/v0/postings/' + encodeURIComponent(company) + '?mode=json');
  return (Array.isArray(json) ? json : [])
    .filter(function (j) { return locationOk_(j.categories && j.categories.location, cityWords); })
    .map(function (j) {
      return job_('Lever', company + '-' + j.id, j.text, companyName_(company),
        j.categories && j.categories.location, '', j.categories && j.categories.commitment,
        j.createdAt, j.descriptionPlain || j.description, j.hostedUrl);
    });
}

function fetchRemotive_(keyword) {
  // Remotive asks that you don't call the API too often and link back to them.
  var json = getJson_('https://remotive.com/api/remote-jobs?limit=' + FETCH.PER_SEARCH +
    '&search=' + encodeURIComponent(keyword));
  return (json.jobs || []).map(function (j) {
    return job_('Remotive', j.id, j.title, j.company_name,
      'Remote' + (j.candidate_required_location ? ' (' + j.candidate_required_location + ')' : ''),
      j.salary, j.job_type, j.publication_date, j.description, j.url);
  });
}

function fetchRemoteOK_(keywords) {
  // RemoteOK requires a link back and mentioning Remote OK as the source.
  var json = getJson_('https://remoteok.com/api');
  var words = keywords.map(function (k) { return k.toLowerCase(); });
  return (Array.isArray(json) ? json : [])
    .filter(function (j) { return j && j.id && j.position; })   // first item is a legal notice
    .filter(function (j) {
      var text = (j.position + ' ' + (j.tags || []).join(' ')).toLowerCase();
      return words.some(function (w) { return text.indexOf(w) !== -1; });
    })
    .slice(0, FETCH.PER_SEARCH)
    .map(function (j) {
      return job_('RemoteOK', j.id, j.position, j.company,
        'Remote' + (j.location ? ' (' + j.location + ')' : ''),
        salaryText_(j.salary_min, j.salary_max, 'USD', 'year'), '',
        j.date, j.description, j.url);
    });
}

// ===================== SHEETS =====================

function getSourcesSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(FETCH.SOURCES_TAB);
  if (!sh) {
    sh = ss.insertSheet(FETCH.SOURCES_TAB);
    sh.getRange(1, 1, 1, 3).setValues([['Type', 'Keyword or Company', 'City']]).setFontWeight('bold');
    sh.getRange(2, 1, 5, 3).setValues([
      ['search', 'Java developer', 'Pune'],
      ['search', 'Accountant', 'Mumbai'],
      ['greenhouse', 'example-company-token', ''],
      ['lever', 'example-company-slug', ''],
      ['remote', 'react', '']
    ]);
    sh.getRange(8, 1).setValue('Types: search = Adzuna + Jooble + Careerjet | greenhouse / lever = company ' +
      'career page name from its URL | remote = Remotive + RemoteOK keyword. Delete the example rows.');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getExternalSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(FETCH.EXTERNAL_TAB);
  if (!sh) {
    sh = ss.insertSheet(FETCH.EXTERNAL_TAB);
    sh.getRange(1, 1, 1, EXTERNAL_HEADERS.length).setValues([EXTERNAL_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['New', 'Approve', 'Reject', 'Published'], true).build();
    sh.getRange('A2:A').setDataValidation(rule);
  }
  return sh;
}

function readSources_() {
  var rows = getSourcesSheet_().getDataRange().getValues().slice(1);
  var out = { searches: [], greenhouse: [], lever: [], remote: [] };
  rows.forEach(function (r) {
    var type = String(r[0]).trim().toLowerCase();
    var value = String(r[1]).trim();
    var city = String(r[2]).trim();
    if (!value || value.indexOf('example-') === 0) return;
    if (type === 'search') out.searches.push({ keyword: value, city: city });
    else if (type === 'greenhouse') out.greenhouse.push(value);
    else if (type === 'lever') out.lever.push(value);
    else if (type === 'remote') out.remote.push(value);
  });
  return out;
}

function saveNewJobs_(jobs) {
  var sh = getExternalSheet_();
  var existing = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, EXTERNAL_HEADERS.length).getValues() : [];
  var seenKeys = {};
  var seenTitleCo = {};
  existing.forEach(function (r) {
    seenKeys[r[10]] = true;
    seenTitleCo[dupKey_(r[2], r[3])] = true;
  });

  var cutoff = Date.now() - FETCH.MAX_AGE_DAYS * 86400000;
  var now = new Date();
  var rows = [];
  jobs.forEach(function (j) {
    if (!j.title || !j.link) return;
    if (j.posted && j.posted.getTime() < cutoff) return;
    var tc = dupKey_(j.title, j.company);
    if (seenKeys[j.key] || seenTitleCo[tc]) return;   // same job from another source = skip
    seenKeys[j.key] = true;
    seenTitleCo[tc] = true;
    rows.push(['New', j.source, j.title, j.company, j.location, j.salary, j.type,
      j.posted || '', j.description, j.link, j.key, now]);
  });
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, EXTERNAL_HEADERS.length).setValues(rows);
  }
  return rows.length;
}

// ===================== HELPERS =====================

function job_(source, id, title, company, location, salary, type, posted, description, link) {
  var d = posted ? new Date(posted) : null;
  if (d && isNaN(d.getTime())) d = null;
  return {
    source: source,
    key: source + ':' + String(id || link),
    title: clean_(title),
    company: clean_(company),
    location: clean_(location),
    salary: clean_(salary),
    type: clean_(type),
    posted: d,
    description: clean_(description).slice(0, FETCH.DESCRIPTION_CHARS),
    link: String(link || '')
  };
}

function getJson_(url) {
  return parseResponse_(UrlFetchApp.fetch(url, { muteHttpExceptions: true }));
}

function parseResponse_(res) {
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + res.getContentText().slice(0, 150));
  }
  return JSON.parse(res.getContentText());
}

function clean_(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function salaryText_(min, max, currency, period) {
  if (!min && !max) return '';
  var f = function (n) { return Math.round(Number(n)).toLocaleString('en-IN'); };
  var range = min && max && min !== max ? f(min) + ' – ' + f(max) : f(min || max);
  return (currency ? currency + ' ' : '') + range + (period ? ' / ' + period : '');
}

function locationOk_(location, cityWords) {
  var filter = FETCH.COMPANY_LOCATION_FILTER.concat(cityWords || []);
  if (!FETCH.COMPANY_LOCATION_FILTER.length) return true;
  var loc = String(location || '').toLowerCase();
  return filter.some(function (w) { return w && loc.indexOf(w) !== -1; });
}

function companyName_(slug) {
  return String(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

function dupKey_(title, company) {
  return (String(title) + '|' + String(company)).toLowerCase().replace(/[^a-z0-9|]/g, '');
}

function shortHash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text));
  return bytes.slice(0, 5).map(function (b) { return ((b + 256) % 256).toString(16); }).join('');
}
