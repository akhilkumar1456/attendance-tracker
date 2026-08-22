const { schedule } = require('@netlify/functions');
const axios = require('axios');
const cheerio = require('cheerio');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, getDoc, updateDoc, setDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyC7ajLbUNu2DT9KWMo0hOUeWJhlrqcvyxY",
  authDomain: "attendence-tracker-69359.firebaseapp.com",
  projectId: "attendence-tracker-69359",
  storageBucket: "attendence-tracker-69359.firebasestorage.app",
  messagingSenderId: "242331512338",
  appId: "1:242331512338:web:ad1c70795c1f1e362bb2cb"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const handler = async function(event, context) {
  const erpUser = process.env.ERP_USERNAME;
  const erpPass = process.env.ERP_PASSWORD;
  const appEmail = process.env.APP_EMAIL;
  const appPass = process.env.APP_PASSWORD;

  if (!erpUser || !erpPass || !appEmail || !appPass) {
    console.error("Missing required environment variables.");
    return { statusCode: 500 };
  }

  try {
    // 1. Authenticate with Firebase
    const userCredential = await signInWithEmailAndPassword(auth, appEmail, appPass);
    const uid = userCredential.user.uid;

    // 2. Fetch ERP Login Page to get __VIEWSTATE
    console.log("Fetching login page...");
    const loginPage = await axios.get('https://login.vardhaman.org/');
    const $login = cheerio.load(loginPage.data);
    const viewState = $login('#__VIEWSTATE').val();
    const eventValidation = $login('#__EVENTVALIDATION').val();

    // 3. Perform ERP Login
    console.log("Logging into ERP...");
    const loginParams = new URLSearchParams();
    loginParams.append('__VIEWSTATE', viewState || '');
    loginParams.append('__EVENTVALIDATION', eventValidation || '');
    loginParams.append('txtuser', erpUser);
    loginParams.append('txtpass', erpPass);
    loginParams.append('btnSubmit', 'Login'); // Assuming button is btnSubmit

    const authResponse = await axios.post('https://login.vardhaman.org/', loginParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': loginPage.headers['set-cookie'] ? loginPage.headers['set-cookie'].join(';') : ''
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const cookies = authResponse.headers['set-cookie'];
    if (!cookies) {
      throw new Error("Login failed: No session cookie returned.");
    }
    const cookieString = cookies.map(c => c.split(';')[0]).join('; ');

    // 4. Fetch Attendance Dashboard
    // The exact URL where the attendance snippet lives. Assuming it's the dashboard.
    const dashboardUrl = 'https://login.vardhaman.org/StudentDashboard.aspx'; 
    const dashResponse = await axios.get(dashboardUrl, {
      headers: { 'Cookie': cookieString }
    });

    const $dash = cheerio.load(dashResponse.data);

    // 5. Parse "Today" and "Yesterday" Attendance
    const updates = {};
    
    $dash('.col-md-6').each((i, el) => {
      const heading = $dash(el).find('h2').text().trim();
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

    console.log("Scraped updates:", updates);

    // 6. Update Firebase
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      throw new Error("User document not found in Firestore.");
    }

    const userData = userSnap.data();
    const subjectsDb = userData.subjects || {};
    let dbUpdated = false;

    for (const [dateStr, dayLogs] of Object.entries(updates)) {
      const logRef = doc(db, `users/${uid}/attendance_logs`, dateStr);
      const logSnap = await getDoc(logRef);
      
      let existingLog = logSnap.exists() ? logSnap.data() : { subjects: {} };
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
        await setDoc(logRef, existingLog, { merge: true });
        console.log(`Updated Firestore log for ${dateStr}`);
      }
    }

    if (dbUpdated) {
      await updateDoc(userRef, { subjects: subjectsDb });
      console.log("Updated overall subject counts.");
    } else {
      console.log("No new attendance updates found.");
    }

    return { statusCode: 200, body: "Success" };
  } catch (error) {
    console.error("Sync Error:", error.message);
    return { statusCode: 500, body: error.message };
  }
};

exports.handler = schedule("30 23 * * *", handler);
