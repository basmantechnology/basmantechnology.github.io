/**
 * BasMan Technology — Jobs, applications & resume storage
 * --------------------------------------------------------------
 * Everything is saved in YOUR Google account:
 *   • Job posts        → "Jobs" tab of the Google Sheet "BasMan Applicants"
 *   • Applications     → "Applicants" tab of the same sheet
 *   • Resume files     → private Google Drive folder "BasMan Resumes"
 *   • Email alerts     → NOTIFY_EMAIL for every application
 *   • Shortlist emails → sent to the candidate when you Approve them
 *
 * The website reads OPEN jobs only. Everyone sees the company name; the recruiter, apply email,
 * phone/WhatsApp, how-to-apply and company website are only for approved Premium members. Everything else — posting jobs, reading
 * applicants, approving — needs your private ADMIN KEY (used by candidates.html).
 *
 * MEMBERS: job seekers register on the website; you approve them (candidates.html → Members).
 * Approved members who log in see the private company & contact details on every job.
 *
 * EMAIL AUTO-POST: email/forward a job to basmantechnology+jobs@gmail.com → posted in ~5 minutes,
 * and you get the Premium + Free WhatsApp posts back by email.
 *
 * SETUP: see README-RESUMES.md (run setup() once, then Deploy → Web app).
 * AFTER CHANGING THIS CODE: Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 */

var FOLDER_NAME  = 'BasMan Resumes';
var SHEET_NAME   = 'BasMan Applicants';
var NOTIFY_EMAIL = 'basmantechnology@gmail.com';
var COMPANY      = 'BasMan Technology';
var MAX_MB       = 10;
var ALLOWED_EXT  = ['pdf', 'doc', 'docx', 'rtf', 'txt'];
var STATUSES     = ['New', 'Shortlisted', 'Rejected'];

var HEADERS = ['ID', 'Submitted', 'Name', 'Job title', 'Email', 'Phone', 'Experience',
               'Skills', 'Role interested in', 'Message', 'Resume file', 'Resume link', 'Resume file ID',
               'LinkedIn', 'Address', 'Job ID', 'Applied for job', 'Status', 'Status updated'];

var MEMBER_HEADERS = ['Member ID', 'Registered', 'Name', 'Email', 'Phone', 'Status', 'Status updated',
                      'Password hash', 'Salt', 'Session token', 'Session expires', 'Last login', 'Notes',
                      'Job title', 'Experience', 'Skills', 'Location', 'Resume name', 'Resume file ID',
                      'Job alerts', 'Reset code', 'Reset expires', 'Last alert', 'Saved message'];
var AUTO_CLOSE_DAYS = 30;           // open jobs older than this close automatically every morning
var DAILY_HOUR      = 8;            // daily tasks run around this hour (script time zone)
var MEMBER_STATUSES = ['Pending', 'Approved', 'Rejected'];
var SESSION_DAYS = 30;
// New members are approved automatically up to and including this date (yyyy-mm-dd).
// After it, they wait as Pending for you to approve. Set to '' to switch auto-approve off now.
var AUTO_APPROVE_UNTIL = '2026-11-30';
var SITE_URL = 'https://basmantechnology.github.io/';

var JOB_HEADERS = ['Job ID', 'Posted', 'Title', 'Category', 'Skills', 'Location', 'Experience',
                   'Job type', 'Description', 'Status', 'Updated',
                   'Domain', 'Requirements', 'Responsibilities',                                   // public
                   'Company', 'Company about', 'Apply email (private)',                              // company public;
                   'Contact phone (private)', 'Company website (private)',                          // never public
                   'Work mode', 'Relevant experience', 'Mandatory skill', 'Openings', 'Salary',     // public
                   'What we look for',                                                              // public
                   'Posted by (private)', 'Apply WhatsApp (private)', 'How to apply (private)'];   // never public

/** Run this ONCE from the editor (select "setup" → Run). Safe to run again. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var folder = getFolder_();
  var sheet = getSheet_();
  getJobsSheet_();
  getMembersSheet_();
  installEmailTrigger_();
  installDailyTrigger_();
  var key = props.getProperty('ADMIN_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    props.setProperty('ADMIN_KEY', key);
  }
  Logger.log('Resumes folder:   ' + folder.getUrl());
  Logger.log('Applicants sheet: ' + sheet.getParent().getUrl());
  Logger.log('ADMIN KEY (keep private — paste it into candidates.html → Sync settings): ' + key);
  Logger.log('Email auto-post is ON: email job posts to ' + JOBS_EMAIL + ' (from ' + ALLOWED_SENDERS.join(', ') + ')');
  Logger.log('Daily tasks are ON (~' + DAILY_HOUR + ':00): auto-close jobs after ' + AUTO_CLOSE_DAYS + ' days, member job alerts, your summary email');
}

// =====================================================================
// POST: website applications (public) + admin actions (need ADMIN KEY)
// =====================================================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'register')   return json_(register_(d));
    if (d.action === 'login')      return json_(memberLogin_(d));
    if (d.action === 'logout')     return json_(memberLogout_(String(d.token || '')));
    if (d.action === 'adminLogin') return json_(adminLogin_(String(d.password || '')));
    if (d.action === 'forgot')     return json_(forgotPassword_(d));
    if (d.action === 'reset')      return json_(resetPassword_(d));
    if (d.action === 'me')         return json_(me_(String(d.token || '')));
    if (d.action === 'updateMe')   return json_(updateMe_(d));
    if (d.action === 'quickApply') return json_(quickApply_(d));
    if (d.action === 'emailApply') return json_(emailApply_(d));
    if (d.action === 'myResume') return json_(myResume_(d));
    if (d.action === 'saveMessage') return json_(saveMessage_(d));
    if (d.action) return json_(admin_(d));
    return json_(apply_(d));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function apply_(d) {
  if (d.website) return { ok: true };                       // spam-bot trap (hidden field)

  var required = ['name', 'email', 'title', 'phone', 'experience', 'skills', 'role', 'address'];
  for (var i = 0; i < required.length; i++) {
    if (!String(d[required[i]] || '').trim()) return { ok: false, error: 'Missing ' + required[i] };
  }

  // Applying to a specific job: it must exist and be open
  var job = null;
  if (d.jobId) {
    job = findJob_(String(d.jobId));
    if (!job || job.status !== 'Open') return { ok: false, error: 'This job is no longer open' };
  }

  var fileName = '', fileUrl = '', fileId = '';
  if (d.resume && d.resume.data) {
    var ext = String(d.resume.name || '').split('.').pop().toLowerCase();
    if (ALLOWED_EXT.indexOf(ext) === -1) return { ok: false, error: 'Resume must be PDF, DOC, DOCX, RTF or TXT' };
    var bytes = Utilities.base64Decode(d.resume.data);
    if (bytes.length > MAX_MB * 1048576) return { ok: false, error: 'Resume is larger than ' + MAX_MB + ' MB' };

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
    fileName = String(d.name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_Resume_' + stamp + '.' + ext;
    var file = getFolder_().createFile(Utilities.newBlob(bytes, d.resume.type || 'application/octet-stream', fileName));
    file.setDescription(d.name + ' — ' + d.title + ' — ' + d.email + ' — ' + d.phone + (job ? ' — for ' + job.title : ''));
    fileUrl = file.getUrl();
    fileId = file.getId();
  }

  var id = Utilities.getUuid();
  var role = job ? job.title : d.role;
  getSheet_().appendRow([
    id, new Date(), clean_(d.name), clean_(d.title), clean_(d.email), clean_(d.phone),
    clean_(d.experience) + ' yrs',   // "yrs" stops Sheets turning "1-3" into a date
    clean_(d.skills), clean_(role), clean_(d.message),
    fileName, fileUrl, fileId, clean_(d.linkedin), clean_(d.address),
    job ? job.id : '', job ? clean_(job.title) : '', 'New', new Date()
  ]);

  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      replyTo: String(d.email),
      subject: (job ? '[Job ' + job.id + '] ' + job.title : 'Job application: ' + d.role) +
               ' — ' + d.name + ' (' + d.experience + ' yrs)',
      body: 'New job application from the website' + (job ? ' for: ' + job.title + ' (Job ID ' + job.id + ')' : '') +
            (job && job.company ? '\nClient company: ' + job.company + (job.applyEmail ? ' (' + job.applyEmail + ')' : '') : '') + '\n\n' +
            'Name: ' + d.name + '\nJob title: ' + d.title + '\nEmail: ' + d.email + '\nPhone: ' + d.phone +
            '\nExperience: ' + d.experience + ' years\nSkills: ' + d.skills + '\nLinkedIn: ' + (d.linkedin || '-') +
            '\nAddress: ' + d.address + '\nRole interested in: ' + role +
            '\n\nMessage:\n' + (d.message || '-') +
            '\n\nResume: ' + (fileUrl || 'not attached') +
            '\n\nTo approve or reject: open candidates.html → Jobs & applications.' +
            '\nAll applicants: ' + getSheet_().getParent().getUrl()
    });
  } catch (mailErr) { /* email quota reached — the data is still saved */ }

  return { ok: true };
}

function admin_(d) {
  if (!isAdmin_(d.key)) return { ok: false, error: 'unauthorized' };
  switch (d.action) {
    case 'saveJob':   return saveJob_(d.job || {});
    case 'deleteJob': return deleteJob_(String(d.id || ''));
    case 'setStatus': return setStatus_(String(d.id || ''), String(d.status || ''), !!d.notify);
    case 'setMemberStatus': return setMemberStatus_(String(d.id || ''), String(d.status || ''), !!d.notify);
    case 'deleteMember':    return deleteMember_(String(d.id || ''));
    case 'setAdminPassword': return setAdminPassword_(String(d.password || ''));
    default:          return { ok: false, error: 'unknown action' };
  }
}

// =====================================================================
// GET: open jobs (public) + private reads (need ADMIN KEY)
// =====================================================================
function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.action === 'jobs') {
    var member = p.token ? memberFromToken_(String(p.token)) : null;
    var open = listJobs_().filter(function (j) { return j.status === 'Open'; });
    return json_({
      ok: true,
      member: member ? { name: member.name } : null,
      sessionExpired: !!p.token && !member,
      jobs: open.map(member ? memberJob_ : publicJob_)
    });
  }

  if (!isAdmin_(p.key)) return json_({ ok: false, error: 'unauthorized' });

  if (p.action === 'alljobs') return json_({ ok: true, jobs: listJobs_() });
  if (p.action === 'members') return json_({ ok: true, members: listMembers_() });

  if (p.action === 'file') {
    var file = DriveApp.getFileById(p.id);
    var folderId = getFolder_().getId(), inFolder = false, parents = file.getParents();
    while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
    if (!inFolder) return json_({ ok: false, error: 'unauthorized' });
    var blob = file.getBlob();
    return json_({ ok: true, name: file.getName(), type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) });
  }

  return json_({ ok: true, candidates: listApplicants_() });
}

// =====================================================================
// Jobs
// =====================================================================
function listJobs_() {
  var rows = getJobsSheet_().getDataRange().getValues();
  rows.shift();
  return rows.filter(function (r) { return r[0]; })
    .map(function (row) { return rowToJob_(row.map(function (v) { return typeof v === 'string' ? v.replace(/^'/, '') : v; })); })
    .sort(function (a, b) { return b.posted - a.posted; });
}

function rowToJob_(r) {
  return {
    id: String(r[0]), posted: toTime_(r[1]), title: String(r[2]), category: String(r[3]),
    skills: String(r[4]), location: String(r[5]), experience: String(r[6]), type: String(r[7]),
    description: String(r[8]), status: String(r[9] || 'Open'), updated: toTime_(r[10]),
    domain: String(r[11] || ''), requirements: String(r[12] || ''), responsibilities: String(r[13] || ''),
    company: String(r[14] || ''), companyAbout: String(r[15] || ''), applyEmail: String(r[16] || ''),
    contactPhone: String(r[17] || ''), companyWebsite: String(r[18] || ''),
    workMode: String(r[19] || ''), relevantExperience: String(r[20] || ''), mandatorySkill: String(r[21] || ''),
    openings: String(r[22] || ''), salary: String(r[23] || ''), lookingFor: String(r[24] || ''),
    postedBy: String(r[25] || ''), applyWhatsapp: String(r[26] || ''), howToApply: String(r[27] || '')
  };
}

// What the public website may see: company name yes; recruiter and contact details no
function publicJob_(j) {
  function scrub(t) {
    t = String(t || '');
    if (j.postedBy && j.postedBy.length > 2) t = t.split(j.postedBy).join('');
    return t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[hidden]')                       // emails
            .replace(/\+?\d[\d\s().-]{6,}\d/g, function (m) {                        // phone numbers:
              var n = m.replace(/\D/g, '').length;                                          // 9+ digits, or +country code
              return (n >= 9 && n <= 15) || (m.charAt(0) === '+' && n >= 8) ? '[hidden]' : m;
            })
            .replace(/\b(https?:\/\/|www\.)\S+/gi, '[hidden]');                         // links
  }
  return {
    id: j.id, posted: j.posted, status: j.status,
    company: j.company, companyAbout: scrub(j.companyAbout),
    title: scrub(j.title), category: j.category, skills: scrub(j.skills), location: j.location,
    experience: j.experience, type: j.type, domain: scrub(j.domain),
    description: scrub(j.description), requirements: scrub(j.requirements), responsibilities: scrub(j.responsibilities),
    workMode: j.workMode, relevantExperience: scrub(j.relevantExperience), mandatorySkill: scrub(j.mandatorySkill),
    openings: j.openings, salary: scrub(j.salary), lookingFor: scrub(j.lookingFor),
    // External jobs (JobFetcher.gs): the source and its public apply link are shown to everyone
    source: externalSource_(j), sourceUrl: externalSource_(j) && /^https?:\/\//i.test(j.howToApply) ? j.howToApply : ''
  };
}

function externalSource_(j) {
  var m = /^External:\s*(.+)$/i.exec(String(j.postedBy || ''));
  return m ? m[1].trim() : '';
}

function findJob_(id) {
  var rows = getJobsSheet_().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === id) return rowToJob_(rows[i]);
  return null;
}

function saveJob_(j) {
  var title = String(j.title || '').trim();
  if (!title) return { ok: false, error: 'Job title is required' };
  var status = j.status === 'Closed' || j.status === 'Filled' ? j.status : 'Open';
  var now = new Date().toISOString();
  var sh = getJobsSheet_();
  var values = [clean_(title), clean_(j.category), clean_(j.skills), clean_(j.location),
                clean_(j.experience), clean_(j.type), clean_(j.description), status, now,
                clean_(j.domain), clean_(j.requirements), clean_(j.responsibilities),
                clean_(j.company), clean_(j.companyAbout), clean_(j.applyEmail),
                clean_(j.contactPhone), clean_(j.companyWebsite),
                clean_(j.workMode), clean_(j.relevantExperience), clean_(j.mandatorySkill), clean_(j.openings),
                clean_(j.salary), clean_(j.lookingFor), clean_(j.postedBy), clean_(j.applyWhatsapp), clean_(j.howToApply)];

  if (j.id) {
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(j.id)) {
        sh.getRange(i + 1, 3, 1, values.length).setValues([values]);
        return { ok: true, job: findJob_(String(j.id)) };
      }
    }
    return { ok: false, error: 'Job not found' };
  }

  var id = 'J' + Utilities.formatDate(new Date(), 'UTC', 'yyMMdd') + '-' +
           Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
  sh.appendRow([id, now].concat(values));
  return { ok: true, job: findJob_(id) };
}

function deleteJob_(id) {
  var sh = getJobsSheet_(), rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === id) { sh.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, error: 'Job not found' };
}

// Approved, logged-in members: public view + the private contact details
function memberJob_(j) {
  var o = publicJob_(j);
  ['postedBy', 'applyEmail', 'applyWhatsapp', 'contactPhone', 'howToApply', 'companyWebsite', 'companyAbout']
    .forEach(function (k) { o[k] = j[k] || ''; });
  ['title', 'skills', 'domain', 'description', 'requirements', 'responsibilities', 'relevantExperience', 'mandatorySkill', 'salary', 'lookingFor']
    .forEach(function (k) { o[k] = j[k] || ''; });   // unscrubbed text
  return o;
}

// =====================================================================
// Members (job seekers who register on the website)
// =====================================================================
function getMembersSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName('Members');
  if (!sh) {
    sh = ss.insertSheet('Members');
    sh.getRange(1, 1, 1000, MEMBER_HEADERS.length).setNumberFormat('@');
  }
  ensureHeaders_(sh, MEMBER_HEADERS);
  return sh;
}

function memberRows_() {
  var sh = getMembersSheet_(), rows = sh.getDataRange().getValues();
  return { sh: sh, rows: rows.map(function (r) { return r.map(function (v) { return typeof v === 'string' ? v.replace(/^'/, '') : v; }); }) };
}

// Same phone written differently? "+965 6586 1821" = "65861821"; "+91 98765 43210" = "9876543210"
function samePhone_(a, b) {
  a = String(a || '').replace(/\D/g, ''); b = String(b || '').replace(/\D/g, '');
  if (a.length < 8 || b.length < 8) return false;
  if (a === b) return true;
  var short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  return short.length >= 8 && long.slice(-short.length) === short;
}

function hash_(password, salt) {
  var h = salt + '|' + password;
  for (var i = 0; i < 300; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  }
  return h;
}

function tooManyTries_(bucket) {
  var c = CacheService.getScriptCache(), n = Number(c.get(bucket) || 0);
  return n >= 5;
}
function failedTry_(bucket) {
  var c = CacheService.getScriptCache(), n = Number(c.get(bucket) || 0) + 1;
  c.put(bucket, String(n), 900);   // 5 wrong passwords → locked for 15 minutes
}

function register_(d) {
  if (d.website) return { ok: true };                      // spam trap
  var name = String(d.name || '').trim(), email = String(d.email || '').trim().toLowerCase();
  var phone = String(d.phone || '').trim(), pw = String(d.password || '');
  if (!name || !phone) return { ok: false, error: 'Please fill in your name and phone' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a valid email' };
  if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };

  var m = memberRows_();
  if (phone.replace(/\D/g, '').length < 8) return { ok: false, error: 'Please enter a valid phone number' };
  for (var i = 1; i < m.rows.length; i++) {
    if (String(m.rows[i][3]).toLowerCase() === email) return { ok: false, error: 'This email is already registered. Please log in.' };
    if (samePhone_(m.rows[i][4], phone)) return { ok: false, error: 'This phone number is already registered. Please log in.' };
  }
  var resume = { name: '', id: '' };
  if (d.resume && d.resume.data) {
    resume = saveResumeFile_(name, d.resume, 'Member');
    if (resume.error) return { ok: false, error: resume.error };
  }
  var salt = Utilities.getUuid().replace(/-/g, '');
  var id = 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  var status = autoApproveOn_() ? 'Approved' : 'Pending';
  m.sh.appendRow([id, new Date().toISOString(), clean_(name), clean_(email), clean_(phone), status, new Date().toISOString(),
                  hash_(pw, salt), salt, '', '', '', '',
                  clean_(d.title), d.experience ? clean_(d.experience) + ' yrs' : '', clean_(d.skills), clean_(d.address),
                  resume.name, resume.id, d.alerts === false ? 'No' : 'Yes', '', '', '']);
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL, replyTo: email,
      subject: 'New member registration — ' + name + (status === 'Approved' ? ' (auto-approved)' : ''),
      body: (status === 'Approved'
              ? 'A job seeker registered on your website and was approved automatically (auto-approve is on until ' + AUTO_APPROVE_UNTIL + ').\n\n'
              : 'A job seeker registered on your website and is waiting for approval.\n\n') +
            'Name: ' + name + '\nEmail: ' + email + '\nPhone: ' + phone +
            (d.title ? '\nTitle: ' + d.title : '') + (d.experience ? '\nExperience: ' + d.experience + ' yrs' : '') +
            (d.skills ? '\nSkills: ' + d.skills : '') + (d.address ? '\nLocation: ' + d.address : '') +
            '\nResume: ' + (resume.id ? 'uploaded' : 'not uploaded') +
            (status === 'Approved' ? '\n\nTo remove access: open candidates.html → Members → Revoke.' : '\n\nApprove or reject: open candidates.html → Members.')
    });
  } catch (mailErr) {}
  if (status === 'Approved') sendApprovedEmail_(email, name);
  return { ok: true, status: status };
}

function memberLogin_(d) {
  var id = String(d.login || d.email || '').trim().toLowerCase(), pw = String(d.password || '');
  var isEmail = id.indexOf('@') !== -1;
  var bucket = 'mfail_' + (isEmail ? id : id.replace(/\D/g, '').slice(-8));
  if (tooManyTries_(bucket)) return { ok: false, error: 'Too many wrong attempts. Please try again in 15 minutes.' };
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    var r = m.rows[i];
    if (isEmail ? String(r[3]).toLowerCase() !== id : !samePhone_(r[4], id)) continue;
    if (hash_(pw, String(r[8])) !== String(r[7])) break;
    if (r[5] === 'Pending')  return { ok: false, status: 'Pending', error: 'Your account is waiting for approval. We will email you once it is approved.' };
    if (r[5] !== 'Approved') return { ok: false, status: String(r[5]), error: 'Your account is not active. Please contact us.' };
    var token = String(r[9] || '');                                  // already logged in elsewhere? share the
    if (token.length < 40 || !(Date.parse(r[10]) > Date.now()))       // session so phone + laptop both stay in
      token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    var expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    m.sh.getRange(i + 1, 10, 1, 3).setValues([[token, expires, new Date().toISOString()]]);
    return { ok: true, token: token, name: String(r[2]), expires: expires };
  }
  failedTry_(bucket);
  return { ok: false, error: 'Wrong email / phone or password' };
}

function memberFromToken_(token) {
  if (!token || token.length < 20) return null;
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    var r = m.rows[i];
    if (String(r[9]) === token) {
      if (r[5] !== 'Approved' || Date.parse(r[10]) < Date.now()) return null;
      return { id: String(r[0]), name: String(r[2]), email: String(r[3]), row: i + 1, r: r };
    }
  }
  return null;
}

function memberLogout_(token) {
  if (!token) return { ok: true };
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    if (String(m.rows[i][9]) === token) { m.sh.getRange(i + 1, 10, 1, 2).setValues([['', '']]); break; }
  }
  return { ok: true };
}

function listMembers_() {
  var m = memberRows_();
  return m.rows.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), registered: toTime_(r[1]), name: String(r[2]), email: String(r[3]), phone: String(r[4]),
             status: MEMBER_STATUSES.indexOf(String(r[5])) !== -1 ? String(r[5]) : 'Pending',
             statusUpdated: toTime_(r[6]), lastLogin: toTime_(r[11]),
             title: String(r[13] || ''), experience: String(r[14] || '').replace(/\s*yrs?$/i, ''), skills: String(r[15] || ''),
             address: String(r[16] || ''), resumeName: String(r[17] || ''), resumeId: String(r[18] || ''),
             alerts: String(r[19] || 'Yes') !== 'No' };
  });                                                       // never sends password hashes or tokens
}

function setMemberStatus_(id, status, notify) {
  if (MEMBER_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Unknown status' };
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    var r = m.rows[i];
    if (String(r[0]) !== id) continue;
    m.sh.getRange(i + 1, 6, 1, 2).setValues([[status, new Date().toISOString()]]);
    if (status !== 'Approved') m.sh.getRange(i + 1, 10, 1, 2).setValues([['', '']]);   // log them out
    var emailed = false;
    if (status === 'Approved' && notify && r[3]) emailed = sendApprovedEmail_(String(r[3]), String(r[2]));
    return { ok: true, status: status, emailed: emailed };
  }
  return { ok: false, error: 'Member not found' };
}

function autoApproveOn_() {
  if (!AUTO_APPROVE_UNTIL) return false;
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return today <= AUTO_APPROVE_UNTIL;
}

function sendApprovedEmail_(email, name) {
  try {
    MailApp.sendEmail({
      to: email, replyTo: NOTIFY_EMAIL, name: COMPANY,
      subject: 'Your ' + COMPANY + ' membership is approved',
      body: 'Hi ' + (String(name).split(' ')[0] || 'there') + ',\n\n' +
            'Good news — your membership has been approved.\n\n' +
            'Log in at ' + SITE_URL + '#jobs with your email (or phone number) and password to see HR emails, ' +
            'phone / WhatsApp numbers and recruiter details for every job.\n\n' +
            'All the best with your job search!\n' + COMPANY + '\n' + NOTIFY_EMAIL
    });
    return true;
  } catch (mailErr) { return false; }
}

function deleteMember_(id) {
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    if (String(m.rows[i][0]) === id) { m.sh.deleteRow(i + 1); return { ok: true }; }
  }
  return { ok: false, error: 'Member not found' };
}

// Saves an uploaded resume into the private Drive folder
function saveResumeFile_(name, resume, prefix) {
  var ext = String(resume.name || '').split('.').pop().toLowerCase();
  if (ALLOWED_EXT.indexOf(ext) === -1) return { error: 'Resume must be PDF, DOC, DOCX, RTF or TXT' };
  var bytes = Utilities.base64Decode(resume.data);
  if (bytes.length > MAX_MB * 1048576) return { error: 'Resume is larger than ' + MAX_MB + ' MB' };
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  var fileName = String(name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '_' + prefix + 'Resume_' + stamp + '.' + ext;
  var file = getFolder_().createFile(Utilities.newBlob(bytes, resume.type || 'application/octet-stream', fileName));
  // Keep the candidate's own file name (e.g. "Rakesh_Basavaraj_CV.pdf") — it is used when the resume is emailed.
  // The copy in Drive keeps the dated name so files never clash.
  var original = String(resume.name || '').split(/[\\/]/).pop().replace(/[:*?"<>|\r\n]+/g, '_').trim().slice(-120);
  if (!original || original.split('.').pop().toLowerCase() !== ext) original = fileName;
  return { name: original, id: file.getId(), url: file.getUrl() };
}

function findMemberByLogin_(login) {
  var id = String(login || '').trim().toLowerCase(), isEmail = id.indexOf('@') !== -1, m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    var r = m.rows[i];
    if (isEmail ? String(r[3]).toLowerCase() === id : samePhone_(r[4], id)) return { m: m, i: i, r: r };
  }
  return null;
}

// ----- Forgot password: 6-digit code by email, valid 15 minutes -----
function forgotPassword_(d) {
  var login = String(d.login || '').trim().toLowerCase();
  var generic = { ok: true, message: 'If this account exists, we have emailed a 6-digit code to its email address.' };
  if (!login) return { ok: false, error: 'Enter your email or phone number' };
  var bucket = 'fp_' + login.replace(/\D/g, '').slice(-8) + login.split('@')[0];
  if (tooManyTries_(bucket)) return { ok: false, error: 'Too many requests. Please try again in 15 minutes.' };
  failedTry_(bucket);                                                     // counts requests (max 5 per 15 min)
  var f = findMemberByLogin_(login);
  if (!f || !f.r[3]) return generic;                                      // never reveal whether an account exists
  var code = String(Math.floor(100000 + Math.random() * 900000));
  f.m.sh.getRange(f.i + 1, 21, 1, 2).setValues([[hash_(code, String(f.r[8])), new Date(Date.now() + 15 * 60000).toISOString()]]);
  try {
    MailApp.sendEmail({
      to: String(f.r[3]), name: COMPANY, subject: COMPANY + ' password reset code: ' + code,
      body: 'Hi ' + (String(f.r[2]).split(' ')[0] || 'there') + ',\n\nYour password reset code is: ' + code +
            '\n\nIt is valid for 15 minutes. If you did not ask for this, ignore this email.\n\n' + COMPANY
    });
  } catch (e) {}
  return generic;
}

function resetPassword_(d) {
  var login = String(d.login || '').trim().toLowerCase(), code = String(d.code || '').trim(), pw = String(d.password || '');
  if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  var bucket = 'rfail_' + login.replace(/\D/g, '').slice(-8) + login.split('@')[0];
  if (tooManyTries_(bucket)) return { ok: false, error: 'Too many wrong codes. Please try again in 15 minutes.' };
  var f = findMemberByLogin_(login);
  if (!f || !f.r[20] || !(Date.parse(f.r[21]) > Date.now()) || hash_(code, String(f.r[8])) !== String(f.r[20])) {
    failedTry_(bucket);
    return { ok: false, error: 'Wrong or expired code. Request a new one.' };
  }
  var salt = Utilities.getUuid().replace(/-/g, '');
  f.m.sh.getRange(f.i + 1, 8, 1, 4).setValues([[hash_(pw, salt), salt, '', '']]);     // new password, log out everywhere
  f.m.sh.getRange(f.i + 1, 21, 1, 2).setValues([['', '']]);
  return { ok: true, status: String(f.r[5]) };
}

// ----- Logged-in member: profile, update, one-click apply -----
function appliedJobIds_(email) {
  email = String(email || '').toLowerCase();
  return listApplicants_().filter(function (a) { return a.jobId && a.email.toLowerCase() === email; }).map(function (a) { return a.jobId; });
}

function me_(token) {
  var mem = memberFromToken_(token);
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var r = mem.r;
  return { ok: true, profile: {
    name: String(r[2]), email: String(r[3]), phone: String(r[4]), title: String(r[13] || ''),
    experience: String(r[14] || '').replace(/\s*yrs?$/i, ''), skills: String(r[15] || ''), address: String(r[16] || ''),
    resumeName: niceResumeName_(r), hasResume: !!r[18], savedMessage: String(r[23] || ''), alerts: String(r[19] || 'Yes') !== 'No'
  }, applied: appliedJobIds_(r[3]) };
}

function updateMe_(d) {
  var mem = memberFromToken_(String(d.token || ''));
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var r = mem.r, resumeName = String(r[17] || ''), resumeId = String(r[18] || '');
  if (d.resume && d.resume.data) {
    var saved = saveResumeFile_(mem.name, d.resume, 'Member');
    if (saved.error) return { ok: false, error: saved.error };
    resumeName = saved.name; resumeId = saved.id;
  }
  getMembersSheet_().getRange(mem.row, 14, 1, 7).setValues([[
    clean_(d.title), d.experience ? clean_(d.experience) + ' yrs' : '', clean_(d.skills), clean_(d.address),
    resumeName, resumeId, d.alerts === false ? 'No' : 'Yes']]);
  return me_(String(d.token));
}

function quickApply_(d) {
  var mem = memberFromToken_(String(d.token || ''));
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var r = mem.r, job = findJob_(String(d.jobId || ''));
  if (!job || job.status !== 'Open') return { ok: false, error: 'This job is no longer open' };
  var viaEmail = d.viaEmail === true;
  if (!r[18] && !viaEmail) return { ok: false, needResume: true, error: 'Please upload your resume in My account first' };
  // "Apply by email": the member emails the recruiter from their own Gmail. We give back a view link to
  // their own resume (they agreed to share it) so it can go in the email body.
  var resumeUrl = '';
  if (viaEmail && d.shareResume && r[18]) {
    try {
      var rf = DriveApp.getFileById(String(r[18]));
      rf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      resumeUrl = 'https://drive.google.com/file/d/' + rf.getId() + '/view';
    } catch (shareErr) {}
  }
  if (appliedJobIds_(r[3]).indexOf(job.id) !== -1) {
    return viaEmail ? { ok: true, already: true, resumeUrl: resumeUrl } : { ok: false, already: true, error: 'You have already applied for this job' };
  }
  var file = r[18] ? DriveApp.getFileById(String(r[18])) : null;
  var exp = String(r[14] || '');
  getSheet_().appendRow([
    Utilities.getUuid(), new Date(), clean_(r[2]), clean_(r[13]), clean_(r[3]), clean_(r[4]),
    exp || '', clean_(r[15]), clean_(job.title),
    clean_(viaEmail ? 'Emailed the recruiter from the website (member ' + r[0] + ')' : (d.message || 'Applied in one click (member ' + r[0] + ')')),
    file ? String(r[17] || file.getName()) : '', file ? file.getUrl() : '', String(r[18] || ''), '', clean_(r[16]),
    job.id, clean_(job.title), 'New', new Date()
  ]);
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL, replyTo: String(r[3]),
      subject: '[Job ' + job.id + '] ' + job.title + ' — ' + r[2] + (viaEmail ? ' (emailed recruiter)' : ' (one-click apply)'),
      body: (viaEmail ? 'A Premium member opened an email to the recruiter for this job.' : 'A Premium member applied in one click.') +
            '\n\nJob: ' + job.title + (job.company ? ' — ' + job.company : '') + (viaEmail && job.applyEmail ? '\nRecruiter: ' + job.applyEmail : '') +
            '\nName: ' + r[2] + '\nEmail: ' + r[3] + '\nPhone: ' + r[4] + '\nTitle: ' + (r[13] || '-') +
            '\nExperience: ' + (exp || '-') + '\nSkills: ' + (r[15] || '-') + '\nLocation: ' + (r[16] || '-') +
            '\nResume: ' + (file ? file.getUrl() : '(none uploaded)') + '\n\nReview: candidates.html → Jobs & applications.'
    });
  } catch (e) {}
  return { ok: true, resumeUrl: resumeUrl };
}

// ----- Apply by email: send the member's application to the recruiter WITH the resume attached -----
// Sent from your Gmail as "Name (via BasMan Technology)". Replies go straight to the candidate,
// the candidate gets a copy (Cc) and you get a copy (Bcc).
var EMAIL_APPLY_PER_DAY = 15;   // max applications one member can send per day

// The resume file name to show / attach. New uploads keep the candidate's own file name.
// Resumes uploaded before that change only have our dated Drive name — show "Name_Resume.pdf" instead.
function niceResumeName_(r) {
  var n = String(r[17] || '');
  if (!/_(Member)?Resume_\d{8}-\d{4}\.\w+$/.test(n)) return n;
  var ext = n.split('.').pop();
  return (String(r[2] || 'My').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'My') + '_Resume.' + ext;
}

// The member's own application message, reused for every job ({job}, {company}, {greeting} are filled in per job)
function saveMessage_(d) {
  var mem = memberFromToken_(String(d.token || ''));
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var msg = String(d.message || '').replace(/\r/g, '').trim().slice(0, 6000);
  getMembersSheet_().getRange(mem.row, 24).setValue(msg ? clean_(msg) : '');
  return { ok: true };
}

// The member's own resume file, so the website can attach it to an email sent from THEIR Gmail
function myResume_(d) {
  var mem = memberFromToken_(String(d.token || ''));
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var r = mem.r;
  if (!r[18]) return { ok: false, needResume: true, error: 'Please upload your resume in My account first' };
  try {
    var blob = DriveApp.getFileById(String(r[18])).getBlob();
    return { ok: true, name: niceResumeName_(r) || blob.getName(), type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) { return { ok: false, needResume: true, error: 'Your resume file was not found. Please upload it again in My account.' }; }
}

// Plain text → simple HTML so Gmail shows it full width like a normal email (not a narrow column)
function textToHtml_(text) {
  var safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  safe = safe.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, function (u) { return '<a href="' + u.replace(/"/g, '&quot;') + '">' + u + '</a>'; });
  safe = safe.replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, '$1<a href="mailto:$2">$2</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">' +
    safe.split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 14px' + (/^—/.test(p) ? ';font-size:12px;color:#888' : '') + '">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
}

function emailApply_(d) {
  var mem = memberFromToken_(String(d.token || ''));
  if (!mem) return { ok: false, error: 'Please log in again', sessionExpired: true };
  var r = mem.r, job = findJob_(String(d.jobId || ''));
  if (!job || job.status !== 'Open') return { ok: false, error: 'This job is no longer open' };
  var to = String(job.applyEmail || '').trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return { ok: false, noEmail: true, error: 'The recruiter email ID is not mentioned for this job' };
  if (!r[18]) return { ok: false, needResume: true, error: 'Please upload your resume in My account first' };
  if (appliedJobIds_(r[3]).indexOf(job.id) !== -1) return { ok: false, already: true, error: 'You have already applied for this job' };
  var cache = CacheService.getScriptCache(), ck = 'eapply_' + r[0], used = Number(cache.get(ck) || 0);
  if (used >= EMAIL_APPLY_PER_DAY) return { ok: false, error: 'You have reached today\'s limit of ' + EMAIL_APPLY_PER_DAY + ' applications. Please try again tomorrow.' };
  if (MailApp.getRemainingDailyQuota() < 4) return { ok: false, quota: true, error: 'Our email limit for today is used up. Please use “Open in my own Gmail” instead.' };

  var name = String(r[2]), email = String(r[3]);
  var subject = String(d.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || ('Application for ' + job.title + ' – ' + name);
  var body = String(d.body || '').replace(/\r/g, '').trim().slice(0, 6000);
  if (!body) return { ok: false, error: 'Please write a short message' };
  body += '\n\n—\nSent via ' + COMPANY + ' (' + SITE_URL + '). Reply to this email to contact ' + name + ' directly.';

  var file;
  try { file = DriveApp.getFileById(String(r[18])); } catch (e) { return { ok: false, needResume: true, error: 'Your resume file was not found. Please upload it again in My account.' }; }
  try {
    MailApp.sendEmail({
      to: to, cc: email, bcc: NOTIFY_EMAIL, replyTo: email,
      name: name.replace(/["<>]/g, '').slice(0, 60) + ' (via ' + COMPANY + ')',
      subject: subject, body: body, htmlBody: textToHtml_(body), attachments: [file.getBlob().setName(niceResumeName_(r) || file.getName())]
    });
  } catch (sendErr) {
    return { ok: false, error: 'Could not send the email: ' + sendErr.message };
  }
  cache.put(ck, String(used + 1), 21600);
  var exp = String(r[14] || '');
  getSheet_().appendRow([
    Utilities.getUuid(), new Date(), clean_(name), clean_(r[13]), clean_(email), clean_(r[4]),
    exp, clean_(r[15]), clean_(job.title), clean_('Emailed recruiter ' + to + ' with resume (member ' + r[0] + ')'),
    String(r[17] || file.getName()), file.getUrl(), String(r[18]), '', clean_(r[16]),
    job.id, clean_(job.title), 'New', new Date()
  ]);
  return { ok: true, to: to };
}

// ----- Admin password login (instead of pasting the long admin key) -----
function adminLogin_(password) {
  if (tooManyTries_('afail')) return { ok: false, error: 'Too many wrong attempts. Try again in 15 minutes.' };
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ADMIN_KEY'), salt = props.getProperty('ADMIN_SALT'), h = props.getProperty('ADMIN_HASH');
  var good = !!key && (password === key || (!!h && hash_(password, salt) === h));
  if (!good) { failedTry_('afail'); return { ok: false, error: 'Wrong password' }; }
  return { ok: true, key: key };
}

function setAdminPassword_(password) {
  if (password.length < 8) return { ok: false, error: 'Use at least 8 characters' };
  var salt = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hash_(password, salt) });
  return { ok: true };
}

// =====================================================================
// Applicants
// =====================================================================
function listApplicants_() {
  var rows = getSheet_().getDataRange().getValues();
  rows.shift();
  return rows.filter(function (r) { return r[0]; }).map(function (row) {
    var r = row.map(function (v) { return typeof v === 'string' ? v.replace(/^'/, '') : v; });   // drop formula-guard quote
    return {
      id: String(r[0]), submitted: toTime_(r[1]),
      name: String(r[2]), title: String(r[3]), email: String(r[4]), phone: String(r[5]),
      experience: String(r[6]).replace(/\s*yrs?$/i, ''), skills: String(r[7]), role: String(r[8]), message: String(r[9]),
      resumeName: String(r[10]), resumeUrl: String(r[11]), resumeId: String(r[12]),
      linkedin: String(r[13] || ''), address: String(r[14] || ''),
      jobId: String(r[15] || ''), jobTitle: String(r[16] || ''),
      status: STATUSES.indexOf(String(r[17])) !== -1 ? String(r[17]) : 'New',
      statusUpdated: toTime_(r[18])
    };
  });
}

function setStatus_(id, status, notify) {
  if (STATUSES.indexOf(status) === -1) return { ok: false, error: 'Unknown status' };
  var sh = getSheet_(), rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== id) continue;
    sh.getRange(i + 1, 18, 1, 2).setValues([[status, new Date()]]);
    var emailed = false;
    if (status === 'Shortlisted' && notify && rows[i][4]) {
      var name = String(rows[i][2]).split(' ')[0] || 'there';
      var role = String(rows[i][16] || rows[i][8] || 'the position');
      try {
        MailApp.sendEmail({
          to: String(rows[i][4]),
          replyTo: NOTIFY_EMAIL,
          name: COMPANY + ' Recruitment',
          subject: 'You have been shortlisted — ' + role,
          body: 'Hi ' + name + ',\n\n' +
                'Thank you for applying for ' + role + ' with ' + COMPANY + '.\n\n' +
                'We have reviewed your profile and are happy to tell you that you have been shortlisted for the next step. ' +
                'Our team will contact you shortly by email or phone to schedule a discussion.\n\n' +
                'If you have any questions, simply reply to this email.\n\n' +
                'Best regards,\n' + COMPANY + ' Recruitment Team\n' + NOTIFY_EMAIL
        });
        emailed = true;
      } catch (mailErr) { /* quota reached — status is still saved */ }
    }
    return { ok: true, status: status, emailed: emailed };
  }
  return { ok: false, error: 'Applicant not found' };
}


// =====================================================================
// EMAIL AUTO-POST
// Email (or forward) a job post to JOBS_EMAIL → within ~5 minutes it is posted on the website
// and you get an email back with the Premium + Free WhatsApp posts.
// Only emails FROM the addresses in ALLOWED_SENDERS are accepted (stops strangers posting jobs).
// =====================================================================
var JOBS_EMAIL      = 'basmantechnology+jobs@gmail.com';
var ALLOWED_SENDERS = [NOTIFY_EMAIL];        // add more, e.g. ['basmantechnology@gmail.com', 'you@gmail.com']
var WA_JOIN_INFO    = '';                    // optional: how to join Premium (link or number) for Free posts
var EXP_JOB = { '0-1': 'Fresher (0–1 Year)', '1-3': '1–3 Years', '4-6': '4–6 Years', '7-9': '7–9 Years', '10-14': '10–14 Years', '15+': '15–20+ Years' };

/** Runs every 5 minutes (installed by setup). You can also Run it by hand to test. */
function checkJobEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var done = GmailApp.getUserLabelByName('jobs-posted') || GmailApp.createLabel('jobs-posted');
    var skipped = GmailApp.getUserLabelByName('jobs-ignored') || GmailApp.createLabel('jobs-ignored');
    var threads = GmailApp.search('(to:' + JOBS_EMAIL + ' OR deliveredto:' + JOBS_EMAIL + ') -label:jobs-posted -label:jobs-ignored newer_than:7d', 0, 20);
    var allowed = ALLOWED_SENDERS.map(function (x) { return String(x).toLowerCase().trim(); });
    threads.forEach(function (th) {
      var msgs = th.getMessages(), m = msgs[msgs.length - 1];
      var from = (String(m.getFrom()).match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0].toLowerCase();
      if (allowed.indexOf(from) === -1) { th.addLabel(skipped); Logger.log('Ignored job email from ' + from); return; }
      var res = postJobsFromEmail_(m.getSubject(), m.getPlainBody());
      replyWithPosts_(from, m.getSubject(), res);
      th.addLabel(done); th.markRead();
    });
  } finally {
    lock.releaseLock();
  }
}

// Turns one email into one or more jobs and posts them. Returns { posted: [...], errors: [...] }
function postJobsFromEmail_(subject, body) {
  var text = cleanEmailBody_(String(body || ''));
  var out = { posted: [], errors: [] }, list = null;

  // 1) Jobs code from Claude:  {"jobs":[ ... ]}
  var a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a !== -1 && b > a && /"title"\s*:/.test(text)) {
    try {
      var data = JSON.parse(text.slice(a, b + 1));
      list = Array.isArray(data) ? data : (data.jobs || (data.title ? [data] : null));
    } catch (e) { out.errors.push('The jobs code looked incomplete, so the post was read as normal text instead.'); }
  }
  // 2) Normal job post(s) — one email may hold several jobs
  if (!list) {
    var chunks = splitJobs(text);
    list = [];
    if (!chunks.length) out.errors.push('Could not find a job in this email. Put the title in the subject, e.g. "Hiring: UiPath Developer", and the job details in the body.');
    chunks.forEach(function (chunk, i) {
      var j = parsePost(chunk);
      if (!j.title && chunks.length === 1) {
        var s = String(subject || '').replace(/^(\s*(fwd?|fw|re)\s*:\s*)+/i, '').trim();
        if (s && !/^job$/i.test(s)) j.title = s.replace(/^(we\s*a?re\s*hiring|hiring)\s*[:|\-–—!]*\s*/i, '').trim();
      }
      if (j.title) list.push(j);
      else out.errors.push((chunks.length > 1 ? 'Job ' + (i + 1) + ': ' : '') + 'could not find a job title' +
        (chunks.length > 1 ? ' — start it with "We are hiring: <title>".' : '. Put it in the email subject, e.g. "Hiring: UiPath Developer".'));
    });
  }

  list.forEach(function (job) {
    var copy = {}; Object.keys(job || {}).forEach(function (k) { if (k !== 'id') copy[k] = job[k]; });
    if (!copy.category) copy.category = 'RPA';
    copy.status = copy.status === 'Closed' || /\[draft\]/i.test(subject) ? 'Closed' : 'Open';
    var r = saveJob_(copy);
    if (r.ok) out.posted.push(r.job); else out.errors.push((copy.title || 'A job') + ': ' + r.error);
  });
  return out;
}

// Removes "Forwarded message" headers, quoted replies and signatures noise
function cleanEmailBody_(t) {
  // Gmail turns words like "VB.NET" into Google redirect links — put back the plain word
  t = t.replace(/<?https?:\/\/(?:www\.)?google\.com\/url\?q=([^&\s>"]+)[^\s>",]*>?/gi, function (m, q) {
    var u = q; try { u = decodeURIComponent(q); } catch (e) {}
    return u.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  });
  return t.replace(/\r/g, '')
    .split('\n')
    .filter(function (l) { return !/^\s*(-{3,}\s*forwarded message\s*-{3,}|from:|sent:|date:|to:|cc:|subject:)/i.test(l) && !/^\s*>/.test(l); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function replyWithPosts_(to, subject, res) {
  var parts = [];
  res.posted.forEach(function (j, i) {
    parts.push(
      (res.posted.length > 1 ? (i + 1) + ') ' : '') + j.title + (j.company ? ' — ' + j.company : '') +
      (j.status === 'Open' ? '\nLive on your website: ' + SITE_URL + '#job-' + j.id : '\nSaved as Closed (not on the website).') +
      '\n\n━━━━━━━━ 💎 PREMIUM GROUP ━━━━━━━━\n\n' + waText(j, true) +
      '\n\n━━━━━━━━ 👥 FREE GROUP ━━━━━━━━\n\n' + waText(j, false) + '\n');
  });
  var warn = [];
  res.posted.forEach(function (j) {
    var miss = [];
    if (!j.location && !j.workMode) miss.push('location');
    if (!j.experience) miss.push('experience');
    if (!j.applyEmail && !j.applyWhatsapp && !j.contactPhone && !j.howToApply) miss.push('how to apply (email / phone / WhatsApp)');
    if (miss.length) warn.push('• ' + j.title + ': missing ' + miss.join(', ') + ' — add it with Edit on your admin page.');
  });
  var body = (res.posted.length ? '✅ ' + res.posted.length + ' job(s) posted.\n\n' : '❌ Nothing was posted.\n\n') +
    (res.errors.length ? 'Problems:\n• ' + res.errors.join('\n• ') + '\n\n' : '') +
    (warn.length ? 'Please check:\n' + warn.join('\n') + '\n\n' : '') +
    (res.posted.length ? 'Copy each post below into its WhatsApp group.\n\n' + parts.join('\n\n') : '') +
    '\n\nManage jobs: ' + SITE_URL + 'candidates.html';
  try {
    MailApp.sendEmail({ to: to, subject: (res.posted.length ? '✅ Posted: ' : '❌ Not posted: ') + String(subject || 'job').replace(/^(\s*(fwd?|fw)\s*:\s*)+/i, ''), body: body });
  } catch (e) {}
}

function installEmailTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkJobEmails'; });
  if (!has) ScriptApp.newTrigger('checkJobEmails').timeBased().everyMinutes(5).create();
}

// ----- Job post reader + WhatsApp template (same as the admin page) -----
  function splitSkills(s) { return String(s || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  var EXP_ORDER = ['0-1', '1-3', '4-6', '7-9', '10-14', '15+'];
  var EXP_LABEL = { '0-1': 'Fresher', '1-3': '1–3 yrs', '4-6': '4–6 yrs', '7-9': '7–9 yrs', '10-14': '10–14 yrs', '15+': '15–20+ yrs' };
  // Accepts a range ("4-6") or an old number (5) and returns the range key
  function expRange(v) {
    v = String(v == null ? '' : v).trim();
    if (EXP_LABEL[v]) return v;
    var n = parseFloat(v); if (isNaN(n)) return '';
    return n < 1 ? '0-1' : n <= 3 ? '1-3' : n <= 6 ? '4-6' : n <= 9 ? '7-9' : n <= 14 ? '10-14' : '15+';
  }
  var TOOLS = ['RPA', 'UiPath', 'Blue Prism', 'Automation Anywhere', 'Power Automate', 'Power Apps', 'Python', 'Java', '.NET', 'C#', 'SQL', 'Excel', 'VBA',
    'SAP', 'Salesforce', 'ServiceNow', 'Selenium', 'Playwright', 'React', 'Angular', 'Node.js', 'AWS', 'Azure', 'GCP', 'DevOps', 'Kubernetes',
    'Docker', 'Kotlin', 'Flutter', 'Swift', 'Android', 'iOS', 'GenAI', 'LLM', 'Machine Learning', 'Power BI', 'Tableau', 'Snowflake', 'Databricks', 'Spark', 'Orchestrator', 'Document Understanding', 'A360'];
  var RPA_TOOLS = /uipath|blue prism|automation anywhere|power automate|\brpa\b|a360/i;

  // Splits text holding several job posts: at separator lines (----, ====, ****) or at each new "hiring" line
  function splitJobs(text) {
    var parts = String(text || '').split(/\n\s*(?:[-=_*~•─━]{5,}|#{3,})\s*\n/);
    var out = [];
    parts.forEach(function (p) {
      var lines = p.split('\n'), cur = [], seenHire = false, hasBody = false;
      lines.forEach(function (l) {
        var hire = /(^|\s|#)(we\s*a?re|we're|is|are|now)\s+#?hiring\b|^\W*#?hiring\b|^\W*we.?re\s+hiring/i.test(l);
        if (hire && seenHire && hasBody) { out.push(cur.join('\n')); cur = []; hasBody = false; }
        if (hire) seenHire = true; else if (l.trim()) hasBody = true;
        cur.push(l);
      });
      if (cur.join('').trim()) out.push(cur.join('\n'));
    });
    return out.map(function (x) { return x.trim(); }).filter(function (x) { return x.length > 20; });
  }

  function parsePost(raw) {
    raw = String(raw || '');
    if (raw.normalize) raw = raw.normalize('NFKC');                     // 𝐖𝐞 𝐚𝐫𝐞 → We are (fancy LinkedIn bold)
    raw = raw.replace(/#(?=[A-Za-z.])/g, '').replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1');   // #RPA → RPA; [a@b](mailto:a@b) → a@b
    var j = {}, lines = raw.replace(/\r/g, '').split('\n');
    var strip = function (l) { return l.replace(/[*_~`]/g, '').replace(/^[^\p{L}\p{N}(₹$]+/u, '').replace(/\s+/g, ' ').trim(); };
    var clean = lines.map(strip);
    var text = clean.join('\n');
    var used = {};
    var label = function (re) {
      for (var i = 0; i < clean.length; i++) {
        var m = clean[i].match(new RegExp('^(?:' + re + ')\\s*(?:[:\\-–—|]\\s*)(.+)$', 'i'));
        if (m) { used[i] = 1; return m[1].trim(); }
      }
      return '';
    };

    // Title
    for (var i = 0; i < clean.length && !j.title; i++) {
      var m = clean[i].match(/hiring\s*(?:[|:\-–—!]+\s*)+(.+)$/i);
      if (m && !/^(for|now)$/i.test(m[1])) { j.title = m[1].replace(/[!🚀🤖]+$/u, '').trim(); used[i] = 1; continue; }
      // "SOAIS is #hiring for a Senior RPA UiPath Developer for the Bangalore location."
      var m2 = clean[i].match(/^(?:(.{2,40}?)\s+(?:is|are)\s+)?#?hiring\s+(?:for\s+)?(?:an?\s+|the\s+)?(.+?)(?:\s+(?:for|in|at)\s+(?:the\s+|our\s+)?([A-Z][\w ]{1,30}?)\s+(?:location|office))?\s*[.!]?$/i);
      if (m2 && m2[2] && m2[2].split(' ').length <= 8) {
        j.title = m2[2].replace(/\s+(?:role|position|opening)$/i, '').trim(); used[i] = 1;
        if (m2[1] && !/^(we|i|our team)$/i.test(m2[1])) j.company = m2[1].replace(/^#/, '').trim();
        if (m2[3]) j.location = m2[3].trim();
      }
    }
    j.title = j.title || label('position|role|job title|designation|opening');
    // "🚀were looking for an experienced RPA BluePrism Developer ready to lead …" → "RPA Blue Prism Developer"
    if (j.title) {
      var tt = j.title.replace(/^[^\p{L}\p{N}]+/u, '');
      var lf = tt.match(/^(?:we.?re|were|we are|is|are)?\s*(?:looking for|seeking|searching for|hiring)\s+(?:an?\s+)?(?:(?:highly\s+)?(?:experienced|skilled|talented|passionate|motivated|dynamic)\s+)*(.+?)(?:\s+(?:ready|who|to join|to lead|to\b|with|that|having)\b|[.,!;(]|$)/i);
      if (lf && lf[1].split(/\s+/).length <= 7) { if (tt.split(/\s+/).length > 8) j._intro = tt.replace(/^(?:we.?re|were)\s+/i, 'We are ').replace(/^we are looking/i, 'We are looking'); tt = lf[1]; }
      j.title = tt.replace(/BluePrism/gi, 'Blue Prism').replace(/UiPath/gi, 'UiPath').replace(/[.!\s]+$/, '').trim();
    }
    if (j.title && j.title === j.title.toUpperCase()) j.title = j.title.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\b(Rpa|Ai|Ml|Sap|Qa|It|Ui|Ux)\b/g, function (w) { return w.toUpperCase(); });

    j.location = label('location|job location|work location|locations') || j.location || '';
    j.location = j.location.split(/,\s*(?=immediate|notice|wfo|wfh)/i)[0].trim();
    j.experience = label('experience(?: required)?|exp|total experience|overall experience');
    if (j.experience) j.experience = j.experience.replace(/(\d+)\s*-\s*(\d+)/, '$1–$2').replace(/\byears?\b/i, 'Years').replace(/\byrs?\b/i, 'Years');
    var notice = label('notice period|notice');
    if (!notice && /immediate joiners?/i.test(text)) notice = 'Immediate';
    j.relevantExperience = label('relevant (?:rpa )?experience|relevant exp');
    j.mandatorySkill = label('mandatory skills?|must have|primary skill');
    j.type = label('employment type|job type|type');
    j.domain = label('domain|industry');
    j.openings = (label('openings?|positions?|no\\.? of (?:positions|openings)|vacancies') || '').replace(/[^\d]/g, '');
    j.salary = label('salary|ctc|package|budget|compensation');
    j.postedBy = label('posted by|recruiter|contact person|hr');
    var co = label('company|client|organization|organisation');
    var mode = label('mode|work mode|work type');
    var pm = text.match(/(?:posted by|shared by)\s*:?\s*([^\n]+)/i);
    if (!j.postedBy && pm) j.postedBy = pm[1].trim();
    var unparen = function (x) { x = String(x || '').trim(); return (x.split('(').length < x.split(')').length) ? x.replace(/\)\s*$/, '').trim() : x; };
    var cm = co.match(/^(.+?)\s*\(posted by\s*(.+?)\)?$/i);
    if (cm) { co = cm[1]; j.postedBy = j.postedBy || cm[2]; }
    j.company = co || j.company || ''; j.postedBy = unparen(j.postedBy);
    if (!j.company) {
      for (i = 0; i < clean.length; i++) {
        var cm2 = clean[i].match(/^([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,4})\s+(?:[—–-]|:)\s+(.{8,80})$/);
        if (cm2 && /technolog|solution|systems|labs|software|consult|services|infotech|pvt|ltd|inc/i.test(cm2[1])) { j.company = cm2[1]; j.companyAbout = cm2[2]; used[i] = 1; break; }
      }
    }
    // Work mode
    var wm = (mode + ' ' + j.location + ' ' + text).toLowerCase();
    j.workMode = /hybrid/.test(wm) ? 'Hybrid' : /(100%\s*)?remote|work from home|wfh/.test(wm) ? 'Remote' : /on-?site|work from office|wfo/.test(wm) ? 'On-site' : '';
    j.location = j.location.replace(/\s*\((hybrid|remote|on-?site)\)\s*/i, '').trim();
    if (!j.location && j.workMode === 'Remote') j.location = 'Remote';
    if (/^(full[\s-]?time|contract|part[\s-]?time|internship|freelance|c2h)/i.test(mode) && !j.type) j.type = mode;
    if (j.type) j.type = j.type.replace(/^full[\s-]?time$/i, 'Full-Time').replace(/^part[\s-]?time$/i, 'Part-Time');
    if (!j.salary) { var sm = text.match(/(?:up to\s*)?₹\s?[\d.,]+\s*(?:LPA|lakhs?|L|CTC)?(?:\s*[-–to]+\s*₹?\s?[\d.,]+\s*(?:LPA|lakhs?|L)?)?|\b\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*LPA\b/i); if (sm) j.salary = sm[0].trim(); }
    if (!j.openings) { var om = text.match(/(\d+)\s*(?:openings|positions|vacancies)/i); if (om) j.openings = om[1]; }

    // Contacts
    var em = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+\w/); if (em) j.applyEmail = em[0];
    var web = text.match(/\b(?:https?:\/\/)?www\.[\w-]+\.[\w.\/-]+/i); if (web) j.companyWebsite = web[0].replace(/^https?:\/\//, '');
    var wa = text.match(/whats\s?app[^\d+\n]{0,20}(\+?\d[\d\s-]{8,}\d)/i);
    if (wa) j.applyWhatsapp = wa[1].replace(/\s+/g, ' ').trim();
    else { var ph = text.match(/(?:\+\d{1,3}[\s-]?)?\b\d{10}\b/); if (ph) j.contactPhone = ph[0]; }
    var how = text.match(/(?:how to apply|to apply)\s*:?\s*([^\n]*(?:dm|linkedin|message|inbox)[^\n]*)/i) || text.match(/((?:dm|message) the recruiter[^\n]*)/i);
    if (!how) how = text.match(/(\bDM\b(?:\s+(?:me|us))?\s+(?:for|with)\b[^\n]{3,80})/i);
    if (how) j.howToApply = how[1].trim().replace(/[.!]+$/, '');
    // "RPA Ops Support BLUE PRISM" → "RPA Ops Support Blue Prism" (keep real acronyms)
    if (j.title && j.title !== j.title.toUpperCase()) j.title = j.title.replace(/\b[A-Z]{4,}\b/g, function (w) {
      return /^(UIPATH|DEVOPS|MLOPS|SAP|AWS|GCP|HTML|JSON|SDET|ITSM|CRM|ERP|SFDC)$/.test(w) ? (w === 'UIPATH' ? 'UiPath' : w === 'DEVOPS' ? 'DevOps' : w) : w.charAt(0) + w.slice(1).toLowerCase();
    });

    // Sections (bullets under a heading)
    var section = null, buckets = { requirements: [], responsibilities: [], lookingFor: [], why: [] }, intro = [];
    var isHead = function (l) {
      var x = l.toLowerCase().replace(/[:?]+$/, '');
      if (l.length > 60 || (!/:$/.test(l) && l.split(/\s+/).length > 6)) return null;
      if (/responsibilit|what you.?ll do|duties|role & resp/.test(x)) return 'responsibilities';
      if (/looking for|qualification|requirement|who you are|eligibility|candidate profile/.test(x)) return 'lookingFor';
      if (/skill|expertise|tech stack|technical|bring to the table|what you.?ll bring|must.?have/.test(x)) return 'requirements';
      if (/nice.?to.?have|good to have|preferred|bonus/.test(x)) return 'lookingFor';
      if (/why join|about us|benefit|perks|what we offer/.test(x)) return 'why';
      if (/job overview|overview|apply|thank|hiring|details/.test(x)) return 'stop';
      return null;
    };
    for (i = 0; i < clean.length; i++) {
      var l = clean[i]; if (!l) continue;
      if (/wishing you|stay connected|keep watching|all the best|premium (?:group|member)|want to apply|join our premium|for more info|more job updates/i.test(l)) continue;
      if (used[i]) continue;
      var inl = l.match(/^([^:]{2,40}):\s*(.+)$/), h = isHead(inl ? inl[1] : l);
      if (h && inl && h !== 'stop' && !/^(how to apply|apply)/i.test(inl[1])) {         // "Skills: UiPath Studio & Orchestrator"
        var parts = inl[2].split(/\s*(?:,|;|\s&\s|\band\b)\s*/).filter(Boolean);
        var first = (parts[0].match(/^(\w+)\s/) || [])[1];                                   // "UiPath Studio & Orchestrator" → both UiPath …
        buckets[h] = buckets[h].concat(parts.map(function (x, k) { return k && first && x.split(' ').length === 1 && parts[0].indexOf(first) === 0 ? first + ' ' + x : x; }));
        section = null; continue;
      }
      if (h) { section = h === 'stop' ? null : h; continue; }
      if (/^(location|experience|exp|position|role|employment type|domain|salary|openings?|company|mode|posted by|apply|apply now|website|email|whatsapp|relevant[\w ]*|mandatory[\w ]*)\s*[:\-–—|]/i.test(l)) { section = section && /^(apply|website|email|whatsapp)/i.test(l) ? null : section; continue; }
      if (/@|www\.|https?:|whatsapp|\bdm\b|thank you|tag professionals|interested candidates|share (?:your|their) (?:updated )?(?:cv|resume)/i.test(l)) continue;
      if (section) buckets[section].push(l.replace(/[.;]+$/, ''));
      else if (l.length > 40 && !/^(we are|we're) hiring/i.test(l)) intro.push(l);
    }
    j.requirements = buckets.requirements.join('\n');
    j.responsibilities = buckets.responsibilities.join('\n');
    j.lookingFor = buckets.lookingFor.concat(notice ? [/immediate/i.test(notice) ? 'Immediate joiners only' : 'Notice period: ' + notice] : []).join('\n');
    j.description = intro.slice(0, 2).join(' ') || j._intro || '';
    delete j._intro;
    if (j.company && j.description) j.description = j.description.split(j.company).join('our client').replace(/(^|[.!?]\s+)our client/g, '$1Our client');

    // Skill tags + category
    var found = TOOLS.filter(function (t) { return new RegExp('(^|[^\\w.])' + t.replace(/[.+#]/g, '\\$&') + '(?![\\w])', 'i').test(text); });
    if (j.mandatorySkill && found.indexOf(j.mandatorySkill) === -1) found.unshift(j.mandatorySkill);
    j.skills = found.slice(0, 8).join(', ');
    j.category = RPA_TOOLS.test(text) ? 'RPA' : (found[0] || '');
    Object.keys(j).forEach(function (k) { if (!j[k]) delete j[k]; });
    return j;
  }


  function waLines(t) { return String(t || '').split(/\n+/).map(function (x) { return x.replace(/^[\s•✅→*-]+/, '').trim(); }).filter(Boolean); }
  function hideCompany(t, j) {
    t = String(t || '');
    if (j.company && j.company.length > 1) t = t.split(new RegExp(j.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join('our client').replace(/(^|[.!?]\s+)our client/g, '$1Our client');
    return t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '').replace(/\b(https?:\/\/|www\.)\S+/gi, '')
      .replace(/\+?\d[\d\s().-]{6,}\d/g, function (m) { var n = m.replace(/\D/g, '').length; return (n >= 9 && n <= 15) || (m.charAt(0) === '+' && n >= 8) ? '' : m; });
  }
  // One template for every job. Sections appear only when the field is filled.
  function waText(j, premium) {
    var P = function (t) { return premium ? String(t || '').trim() : hideCompany(t, j).trim(); };
    var L = [], add = function () { for (var i = 0; i < arguments.length; i++) L.push(arguments[i]); };
    var exp = EXP_JOB[j.experience] || j.experience;
    var loc = [j.location, j.workMode && (j.location || '').toLowerCase() !== j.workMode.toLowerCase() ? j.workMode : ''].filter(Boolean);

    add('🚀 *WE ARE HIRING | ' + P(j.title) + '*', '');
    if (premium && (j.company || j.postedBy)) {
      if (j.company) add(j.companyAbout ? '🏢 *' + j.company + '*: ' + j.companyAbout : '🏢 Company: *' + j.company + '*');
      if (j.postedBy) add('👤 Posted by: ' + j.postedBy);
      add('');
    }
    var ov = [];
    if (loc.length) ov.push('📍 Location: ' + (loc.length === 2 ? loc[0] + ' (' + loc[1] + ')' : loc[0]));
    if (exp) ov.push('💼 Experience: ' + exp);
    if (j.relevantExperience) ov.push('🔹 Relevant Experience: ' + P(j.relevantExperience));
    if (j.mandatorySkill) ov.push('⭐ *Mandatory Skill: ' + P(j.mandatorySkill) + '*');
    if (j.type) ov.push('🕒 Employment Type: ' + j.type);
    if (j.domain) ov.push('🏭 Domain: ' + P(j.domain));
    if (j.openings) ov.push('👥 Openings: ' + j.openings);
    if (j.salary) ov.push('💰 Salary: ' + P(j.salary));
    if (ov.length) add.apply(null, ov.concat(['']));

    if (j.description) add(P(j.description), '');

    var req = waLines(P(j.requirements)); if (!req.length) req = splitSkills(P(j.skills));
    if (req.length) { add('*🔹 Key Skills & Technical Expertise:*'); req.forEach(function (x) { add('✅ ' + x); }); add(''); }
    var resp = waLines(P(j.responsibilities));
    if (resp.length) { add('*🎯 Key Responsibilities:*'); resp.forEach(function (x) { add('→ ' + x); }); add(''); }
    var lf = waLines(P(j.lookingFor));
    if (lf.length) { add("*🔸 What We're Looking For:*"); lf.forEach(function (x) { add('🔸 ' + x); }); add(''); }

    if (premium) {
      var ap = [];
      if (j.applyEmail) ap.push('📩 *Apply Now:* ' + j.applyEmail);
      if (j.applyWhatsapp) ap.push('📱 *Apply via WhatsApp:* ' + j.applyWhatsapp + ' (share your updated CV)');
      if (j.contactPhone) ap.push('📞 *Contact:* ' + j.contactPhone);
      if (j.howToApply) ap.push('💬 *How to Apply:* ' + j.howToApply);
      if (j.companyWebsite) ap.push('🌐 *Website:* ' + j.companyWebsite);
      if (ap.length) add.apply(null, ap.concat(['']));
      if (j.id && (!j.status || j.status === 'Open')) add('🌐 *Also on our website (one-click apply):*', jobLink(j.id), '');
      add('🙏 *Thank you for being a valued Premium Member!*', 'Wishing you all the best in your job search. Keep watching this group for more exclusive openings! 💼✨');
    } else {
      var join = WA_JOIN_INFO;
      if (false) add('👉 *Apply here:* ' + jobLink(j.id), '', '🔒 Company name & HR contact are shared only in our *Premium Group* 💎');
      else add('🔒 *Want to apply?*', 'Contact details & application link are shared only in our *Premium Group* 💎');
      add('', '👉 *Join our Premium Group for more info!*' + (join ? '\n' + join : ''), '',
          '🙏 *Thank you for being part of our community!*', 'Stay connected for more job updates. All the best! 💼✨');
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function jobLink(id) { return SITE_URL + '#job-' + encodeURIComponent(id); }

// =====================================================================
// DAILY TASKS (installed by setup, runs every morning around DAILY_HOUR)
//   1. closes open jobs older than AUTO_CLOSE_DAYS
//   2. emails each Premium member the new jobs that match their skills (if alerts are on)
//   3. emails you a summary of the last 24 hours
// =====================================================================
function dailyTasks() {
  var closed = autoCloseJobs_();
  var alerts = sendJobAlerts_();
  sendDailySummary_(closed, alerts);
}

function installDailyTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyTasks'; });
  if (!has) ScriptApp.newTrigger('dailyTasks').timeBased().everyDays(1).atHour(DAILY_HOUR).create();
}

function autoCloseJobs_() {
  var sh = getJobsSheet_(), rows = sh.getDataRange().getValues(), cutoff = Date.now() - AUTO_CLOSE_DAYS * 86400000, closed = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][9] || 'Open') === 'Open' && toTime_(rows[i][1]) && toTime_(rows[i][1]) < cutoff) {
      sh.getRange(i + 1, 10, 1, 2).setValues([['Closed', new Date().toISOString()]]);
      closed.push(String(rows[i][2]));
    }
  }
  return closed;
}

// Does a job match a member's skills? Any of their skills (2+ letters) found in the job text.
function jobMatches_(job, skills) {
  var text = [job.title, job.category, job.skills, job.mandatorySkill, job.requirements].join(' ').toLowerCase();
  return String(skills || '').split(/[,;\/\n]+/).map(function (x) { return x.trim().toLowerCase(); })
    .filter(function (x) { return x.length >= 2; })
    .some(function (k) { return text.indexOf(k) !== -1; });
}

function sendJobAlerts_() {
  var since = Date.now() - 24 * 3600000;
  var fresh = listJobs_().filter(function (j) { return j.status === 'Open' && j.posted >= since; });
  var res = { sent: 0, skipped: 0, newJobs: fresh.length };
  if (!fresh.length) return res;
  var m = memberRows_();
  for (var i = 1; i < m.rows.length; i++) {
    var r = m.rows[i];
    if (r[5] !== 'Approved' || String(r[19] || 'Yes') === 'No' || !r[3] || !r[15]) continue;
    var mine = fresh.filter(function (j) { return jobMatches_(j, r[15]); });
    if (!mine.length) continue;
    if (MailApp.getRemainingDailyQuota() < 15) { res.skipped++; continue; }   // keep emails for applications
    var lines = mine.map(function (j) {
      return '• ' + j.title + (j.company ? ' — ' + j.company : '') +
             (j.location ? ' | ' + j.location : '') + (j.experience ? ' | ' + (EXP_JOB[j.experience] || j.experience) : '') +
             '\n  ' + SITE_URL + '#job-' + j.id;
    });
    try {
      MailApp.sendEmail({
        to: String(r[3]), name: COMPANY, replyTo: NOTIFY_EMAIL,
        subject: mine.length + ' new job' + (mine.length === 1 ? '' : 's') + ' matching your skills — ' + COMPANY,
        body: 'Hi ' + (String(r[2]).split(' ')[0] || 'there') + ',\n\nNew jobs matching your skills (' + r[15] + '):\n\n' +
              lines.join('\n\n') +
              '\n\nLog in on our website to see the HR email and phone, or apply in one click.\n\n' +
              'To change your skills or stop these alerts: log in → My account.\n\n' + COMPANY
      });
      m.sh.getRange(i + 1, 23).setValue(new Date().toISOString());
      res.sent++;
    } catch (e) { res.skipped++; }
  }
  return res;
}

function sendDailySummary_(closed, alerts) {
  var since = Date.now() - 24 * 3600000;
  var jobs = listJobs_(), apps = listApplicants_(), members = listMembers_();
  var newJobs = jobs.filter(function (j) { return j.posted >= since; });
  var newApps = apps.filter(function (a) { return a.submitted >= since; });
  var waitingApps = apps.filter(function (a) { return a.status === 'New'; });
  var newMembers = members.filter(function (x) { return x.registered >= since; });
  var waitingMembers = members.filter(function (x) { return x.status === 'Pending'; });
  var L = [];
  L.push('Your BasMan summary for the last 24 hours\n');
  L.push('📢 New jobs posted: ' + newJobs.length);
  newJobs.forEach(function (j) { L.push('   • ' + j.title + (j.company ? ' — ' + j.company : '')); });
  L.push('\n📄 New applications: ' + newApps.length);
  newApps.forEach(function (a) { L.push('   • ' + a.name + ' → ' + (a.jobTitle || a.role || 'general')); });
  L.push('   Waiting for your review (all time): ' + waitingApps.length);
  L.push('\n👥 New member registrations: ' + newMembers.length);
  L.push('   Waiting for approval: ' + waitingMembers.length);
  waitingMembers.slice(0, 10).forEach(function (x) { L.push('   • ' + x.name + ' (' + x.email + ')'); });
  L.push('\n🔒 Jobs auto-closed (older than ' + AUTO_CLOSE_DAYS + ' days): ' + closed.length);
  closed.forEach(function (t) { L.push('   • ' + t); });
  L.push('\n🔔 Job alert emails sent to members: ' + alerts.sent + (alerts.skipped ? ' (' + alerts.skipped + ' skipped — daily email limit)' : ''));
  L.push('\n📊 Open jobs now: ' + jobs.filter(function (j) { return j.status === 'Open'; }).length +
         ' | Approved members: ' + members.filter(function (x) { return x.status === 'Approved'; }).length);
  L.push('\nManage everything: ' + SITE_URL + 'candidates.html');
  try {
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: '📊 BasMan daily summary — ' + newApps.length + ' new applications, ' + waitingMembers.length + ' members waiting', body: L.join('\n') });
  } catch (e) {}
}

// =====================================================================
// Helpers
// =====================================================================
function isAdmin_(key) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!real && key === real;
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function getSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) {} }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    ss.getSheets()[0].setName('Applicants');
    props.setProperty('SHEET_ID', ss.getId());
  }
  return ss;
}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName('Applicants') || ss.getSheets()[0];
  ensureHeaders_(sh, HEADERS);
  return sh;
}

function getJobsSheet_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName('Jobs');
  if (!sh) {
    sh = ss.insertSheet('Jobs');
    sh.getRange(1, 1, 1000, JOB_HEADERS.length).setNumberFormat('@');   // plain text: no date surprises
  }
  ensureHeaders_(sh, JOB_HEADERS);
  return sh;
}

// Writes / extends the bold header row (also upgrades older sheets with new columns)
function ensureHeaders_(sh, headers) {
  if (sh.getLastColumn() >= headers.length && String(sh.getRange(1, headers.length).getValue()) === headers[headers.length - 1]) return;
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#A01A25').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  return Date.parse(v) || 0;
}

// Stops text like "=HYPERLINK(...)" being run as a spreadsheet formula
function clean_(v) {
  var s = String(v == null ? '' : v).trim().slice(0, 5000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
