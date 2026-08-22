const { schedule } = require('@netlify/functions');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT");
    
    let serviceAccount;
    if (serviceAccountStr.trim().startsWith('{')) {
      serviceAccount = JSON.parse(serviceAccountStr);
    } else {
      serviceAccount = JSON.parse(Buffer.from(serviceAccountStr, 'base64').toString('utf8'));
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (err) {
    console.error("Failed to initialize Firebase Admin:", err.message);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

const handler = async function(event, context) {
  if (!db) return { statusCode: 500, body: "Database not initialized" };

  try {
    // 1. Fetch all users who have an ERP username and password set
    const usersSnap = await db.collection('users')
      .orderBy('erpUsername')
      .get();

    if (usersSnap.empty) {
      console.log("No users with ERP credentials found.");
      return { statusCode: 200, body: "No users to sync" };
    }

    console.log(`Starting sync for ${usersSnap.size} users...`);

    // 2. Loop through each user and sync their data
    for (const docSnap of usersSnap.docs) {
      const uid = docSnap.id;
      const userData = docSnap.data();
      
      const erpUser = userData.erpUsername;
      const erpPass = userData.erpPassword;

      if (!erpUser || !erpPass) continue;

      console.log(`Syncing user: ${uid} (${erpUser})`);
      
      try {
        await syncUserAttendance(uid, userData, erpUser, erpPass);
        console.log(`Successfully synced ${uid}`);
      } catch (err) {
        console.error(`Error syncing user ${uid}:`, err.message);
        // Continue to the next user even if one fails
      }
    }

    return { statusCode: 200, body: "Sync complete" };
  } catch (error) {
    console.error("Global Sync Error:", error.message);
    return { statusCode: 500, body: error.message };
  }
};

async function syncUserAttendance(uid, userData, erpUser, erpPass) {
  // 1. Fetch ERP Login Page to get __VIEWSTATE
  const loginPage = await axios.get('https://login.vardhaman.org/');
  const $login = cheerio.load(loginPage.data);
  const viewState = $login('#__VIEWSTATE').val();
  const eventValidation = $login('#__EVENTVALIDATION').val();

  // 2. Perform ERP Login
  const loginParams = new URLSearchParams();
  loginParams.append('__VIEWSTATE', viewState || '');
  loginParams.append('__EVENTVALIDATION', eventValidation || '');
  loginParams.append('txtuser', erpUser);
  loginParams.append('txtpass', erpPass);
  loginParams.append('btnSubmit', 'Login');

  const authResponse = await axios.post('https://login.vardhaman.org/', loginParams.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': loginPage.headers['set-cookie'] ? loginPage.headers['set-cookie'].join(';') : ''
    },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400
  });

  const cookies = authResponse.headers['set-cookie'];
  if (!cookies) throw new Error("Login failed: No session cookie returned.");
  const cookieString = cookies.map(c => c.split(';')[0]).join('; ');

  // 3. Fetch Attendance Dashboard
  const dashboardUrl = 'https://login.vardhaman.org/StudentDashboard.aspx'; 
  const dashResponse = await axios.get(dashboardUrl, {
    headers: { 'Cookie': cookieString }
  });

  const $dash = cheerio.load(dashResponse.data);

  // 4. Parse "Today" and "Yesterday" Attendance
  const updates = {};
  
  $dash('.col-md-6').each((i, el) => {
    const dateText = $dash(el).find('.date-inr').text().trim();
    if (!dateText) return;
    
    const dateObj = new Date(dateText);
    if (isNaN(dateObj.getTime())) return;
    const dateKey = dateObj.toISOString().split('T')[0];
    
    if (!updates[dateKey]) updates[dateKey] = {};

    $dash(el).find('li').each((j, li) => {
      const subject = $dash(li).find('h5').text().trim();
      const status = $dash(li).find('.status').text().trim().toLowerCase();
      
      if (subject && status) {
        updates[dateKey][subject] = status.includes('present') ? 'present' : 'absent';
      }
    });
  });

  // 5. Update Firebase User Document
  const subjectsDb = userData.subjects || {};
  let dbUpdated = false;

  for (const [dateStr, dayLogs] of Object.entries(updates)) {
    const logRef = db.collection('users').doc(uid).collection('attendance_logs').doc(dateStr);
    const logSnap = await logRef.get();
    
    let existingLog = logSnap.exists ? logSnap.data() : { subjects: {} };
    let logsChanged = false;

    for (const [subj, status] of Object.entries(dayLogs)) {
      let normalizedSubj = Object.keys(subjectsDb).find(s => s.toLowerCase() === subj.toLowerCase());
      if (!normalizedSubj) {
         normalizedSubj = subj;
         subjectsDb[normalizedSubj] = { loggedConducted: 0, loggedAttended: 0 };
      }

      const previousStatus = existingLog.subjects[normalizedSubj];
      
      if (previousStatus !== status) {
        logsChanged = true;
        existingLog.subjects[normalizedSubj] = status;

        if (previousStatus === 'present') {
          subjectsDb[normalizedSubj].loggedAttended -= 1;
          subjectsDb[normalizedSubj].loggedConducted -= 1;
        } else if (previousStatus === 'absent') {
          subjectsDb[normalizedSubj].loggedConducted -= 1;
        }

        if (status === 'present') {
          subjectsDb[normalizedSubj].loggedAttended += 1;
          subjectsDb[normalizedSubj].loggedConducted += 1;
        } else if (status === 'absent') {
          subjectsDb[normalizedSubj].loggedConducted += 1;
        }
      }
    }

    if (logsChanged) {
      dbUpdated = true;
      existingLog.editableUntil = new Date(Date.now() + 86400000).toISOString(); 
      await logRef.set(existingLog, { merge: true });
    }
  }

  if (dbUpdated) {
    await db.collection('users').doc(uid).update({ subjects: subjectsDb });
  }
}

exports.handler = schedule("30 23 * * *", handler);
