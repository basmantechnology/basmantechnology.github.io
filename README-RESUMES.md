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
