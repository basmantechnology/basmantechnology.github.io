# Saving Careers resumes to Google Drive — setup (about 10 minutes)

When someone applies on the website, their resume goes into a private **Google Drive** folder, their details go into a **Google Sheet**, and you get an email. Only you can see the files.

## 1. Create the script
1. Open https://script.google.com while signed in as **basmantechnology@gmail.com**, then click **New project**.
2. Delete the sample code, paste in everything from `google-apps-script/Code.gs`, and press **Ctrl + S**. You can name the project "BasMan Careers".

## 2. Run setup once
1. In the toolbar dropdown, choose **setup**, then click **Run**.
2. Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced → Go to BasMan Careers (unsafe)**, then **Allow**.
   (This warning appears because it is your own private script, not a published app.)
3. Open **Execution log**. It shows three things:
   - the **Resumes folder** link
   - the **Applicants sheet** link
   - your **ADMIN KEY**. Copy it and keep it private, like a password.

## 3. Publish it as a web app
1. Click **Deploy → New deployment**, click the ⚙ icon, and choose **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**. Then click **Deploy**.
3. Copy the **Web app URL**. It ends in `/exec`.

## 4. Connect the website
In `index.html`, find this line:

```js
var CAREERS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_URL_HERE';
```

Paste your `/exec` URL between the quotes, then upload `index.html` to GitHub as usual.

Until you do this, the form still works, but it only emails the details without the resume.

## 5. Connect the candidates page
Open `candidates.html` and click **☁ Sync applicants**. Paste the **/exec URL** and the **ADMIN KEY**, then click **Save & sync now**.
After that, one click on **☁ Sync applicants** imports every new applicant with their resume, ready to send to vendors.

---

**If you change Code.gs later:** go to Deploy → Manage deployments → ✏️ Edit, set Version to **New version**, then Deploy. The URL stays the same.

**Is it safe?** The website code contains only the `/exec` URL. That URL can submit applications but cannot read anything. Reading applicants needs the ADMIN KEY, which is never in the website code. It is saved only in the browser where you typed it.

**Already set up with an older Code.gs?** Paste in the new Code.gs, then publish a New version (see above). Also add two column headings at the end of row 1 of your "BasMan Applicants" sheet: **LinkedIn** and **Address**.


---

# Jobs board (new)

## Update the Google script (needed once)
1. Open your project on **script.google.com**, select all the old code, and paste in the new `google-apps-script/Code.gs`. Then press **Ctrl + S**.
2. Choose **setup** and click **▷ Run**. This adds a **Jobs** tab to your sheet and new columns to Applicants. Your existing applicants are kept.
3. Click **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
4. Upload the new `index.html` and `candidates.html` to GitHub.

## Post a job
`candidates.html` → **Jobs & applications** → **+ Post job**. It appears on your website straight away, newest first.
Visitors filter by skill (RPA, UiPath, App Development…), by date posted and by location, then click **Apply now**.

## Private client details
In the **🔒 Private** box, add the client company, tagline, apply email, phone and website.
These are **never sent to the website**. The company name is also removed automatically from the public text, along with any emails, phone numbers and links.

## WhatsApp posts
Click **📱 WhatsApp post** on any job to get two ready-made versions:
- **Free group:** company name and contact details hidden. You can optionally add your website apply link.
- **Premium group:** includes the company, apply email, phone and website.

## Approve applicants
You get an email for every application, with the job named in the subject.
On **Jobs & applications**, click **Review applicants** → **✓ Approve** or **✕ Reject**.
Approving sends the candidate a "You have been shortlisted" email. Untick the box if you don't want that.
The red number on the tab shows how many applications are waiting for review.


---

# Job post template (paste → post → WhatsApp)

1. **+ Post job → 📋 Paste a recruiter post** (from LinkedIn, WhatsApp or email) **→ ✨ Fill form from post.**
2. **Check every field.** The reader is good but not perfect. Add anything missing, such as the location or the recruiter's name.
3. **Click Post job.** It goes live on your website, and the **WhatsApp posts** open straight away:
   - **💎 Premium:** company, recruiter, apply email, WhatsApp number, how to apply and website
   - **👥 Free:** the same job without any company or contact details
4. **Copy each post** into its group, or use **Open in WhatsApp**.

Every post uses the same template. A section only appears when you filled it in:
title → company and recruiter (Premium only) → location, experience, relevant experience, mandatory skill, type, domain, openings, salary → intro → ✅ key skills → → responsibilities → 🔸 what we're looking for → how to apply (Premium only) → footer.

**Post only to WhatsApp, not the website?** Set **Status: Closed** before posting. The WhatsApp posts still work.

## Your 3 previous jobs
`previous-jobs.json` holds the Senior RPA Developer, UiPath RPA Developer and Automation Engineer jobs.
Go to **Jobs & applications → ⬆ Import jobs** and choose that file. All three are posted in one go.
- **Senior RPA Developer:** the recruiter's name and contact weren't in the original post, so add them (Edit job → 🔒 Private) before sending the Premium version.
- **Automation Engineer:** no location was given. Add it if you know it.


---

# Admin login & members

## Update (needed once)
1. **Paste the new Code.gs** into your script (BasManTechnlodData), save, and run **setup**. This adds a **Members** tab to your sheet.
2. **Publish a new version:** **Deploy → Manage deployments → ✏️ → New version → Deploy**.
3. **Upload to GitHub:** the new `index.html` and `candidates.html`.

## Admin login
- `candidates.html` now opens with an **Admin login** screen.
- **First time:** log in with your **admin key**, then click **🔑 Password** and set an easy password (at least 8 characters). Use that password from then on, on any device.
- **⎋ Log out** when you're on a shared computer.
- **5 wrong passwords** lock the login for 15 minutes.

## Members (job seekers)
- **Visitors** see jobs without company or contacts, plus a **Log in / Register** button.
- **When someone registers,** you get an email. Open **candidates.html → Members** and click **✓ Approve**. They get an email saying they're approved.
- **Everyone** sees the job and the **company name**.
- **Approved Premium members** who log in also see the **recruiter, HR email, WhatsApp, phone, how to apply and company website**.
- **Revoke access** logs a member out straight away. **Delete** removes their account completely.
- **Passwords** are stored scrambled (hashed), so nobody can read them, not even you. A member who forgets their password: delete their account and ask them to register again.
