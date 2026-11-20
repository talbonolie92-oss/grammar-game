// ------------------------------------------------------------
// js/setup-check.js
// Runs a few simple tests so you know Firebase is set up correctly.
// You can keep this page, or delete it when the app is finished.
// ------------------------------------------------------------
import { auth, db, configMissing } from "./firebase-config.js";
import {
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);

// state is "ok", "fail", "warn" or "" (still checking)
function setCheck(id, state, badge, message) {
  const el = $(id);
  el.className = "check " + state;
  el.querySelector(".badge").textContent = badge;
  el.querySelector(".msg").textContent = message;
}

function isPermissionError(err) {
  return /permission/i.test((err && (err.code || err.message)) || "");
}

async function runChecks() {
  // 1. Settings pasted?
  if (configMissing) {
    setCheck("chkConfig", "fail", "Failed",
      "Open js/firebase-config.js and replace every PASTE_... value with your Firebase settings. Then reload this page.");
    ["chkConnect", "chkAnon", "chkRules"].forEach((id) =>
      setCheck(id, "", "Waiting", "Fix step 1 first."));
    $("teacherBox").classList.add("hidden");
    return;
  }
  setCheck("chkConfig", "ok", "Passed", "Settings found.");

  // 2. Can we reach the database?
  const connected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10000);
    onValue(ref(db, ".info/connected"), (snap) => {
      if (snap.val() === true) { clearTimeout(timer); resolve(true); }
    });
  });
  if (!connected) {
    setCheck("chkConnect", "fail", "Failed",
      "Could not connect. Check that databaseURL in js/firebase-config.js is exactly the address shown on the Realtime Database page, and that you created the database.");
    return;
  }
  setCheck("chkConnect", "ok", "Passed", "Connected.");

  // 3. Anonymous sign-in (this is how students will sign in)
  let uid = null;
  try {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    setCheck("chkAnon", "ok", "Passed", "Signed in as a guest. Guest ID: " + uid);
  } catch (err) {
    const msg = err && err.code === "auth/operation-not-allowed"
      ? "Anonymous sign-in is turned off. In Firebase go to Authentication > Sign-in method and enable Anonymous."
      : "Could not sign in: " + (err.code || err.message);
    setCheck("chkAnon", "fail", "Failed", msg);
    return;
  }

  // 4. Security rules: my own teacher-list entry must be readable,
  //    but a random place in the database must be locked.
  try {
    await get(ref(db, "allowedTeachers/" + uid));
  } catch (err) {
    setCheck("chkRules", "fail", "Failed",
      "The rules from database.rules.json are not published yet. In Firebase open Realtime Database > Rules, paste the file contents, and press Publish.");
    return;
  }
  try {
    await get(ref(db, "rulesTest"));
    setCheck("chkRules", "warn", "Warning",
      "Your database is still open to everyone (test mode). Publish the rules from database.rules.json before using the app with students.");
  } catch (err) {
    if (isPermissionError(err)) {
      setCheck("chkRules", "ok", "Passed", "The database is locked correctly.");
    } else {
      setCheck("chkRules", "fail", "Failed", "Unexpected error: " + (err.code || err.message));
    }
  }
}

// 5. Teacher login test
$("teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (configMissing) return;
  const box = $("chkTeacher");
  box.classList.remove("hidden");
  $("uidBox").classList.add("hidden");
  setCheck("chkTeacher", "", "Checking", "Signing in…");
  $("teacherBtn").disabled = true;

  try {
    const cred = await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
    const uid = cred.user.uid;

    let allowed = false;
    try {
      const snap = await get(ref(db, "allowedTeachers/" + uid));
      allowed = snap.val() === true;
    } catch (err) { allowed = false; }

    if (allowed) {
      setCheck("chkTeacher", "ok", "Passed", "Login works and this account is on the allowed teachers list.");
    } else {
      setCheck("chkTeacher", "warn", "Almost",
        "Login works, but this account is not on the allowed teachers list yet. In Firebase open Realtime Database > Data and add allowedTeachers, then a child named with the ID below and the value true. Then run this test again.");
      $("uidBox").textContent = uid;
      $("uidBox").classList.remove("hidden");
    }
    await signOut(auth);
  } catch (err) {
    const code = (err && err.code) || "";
    let msg = "Could not log in: " + (err.message || code);
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
      msg = "Wrong email or password. Check the user you added under Authentication > Users.";
    } else if (code.includes("operation-not-allowed")) {
      msg = "Email/Password sign-in is turned off. In Firebase go to Authentication > Sign-in method and enable Email/Password.";
    }
    setCheck("chkTeacher", "fail", "Failed", msg);
  } finally {
    $("teacherBtn").disabled = false;
  }
});

runChecks();
