// ------------------------------------------------------------
// js/firebase-config.js
//
// YOU EDIT THIS FILE ONE TIME: replace each PASTE_... value with
// the settings from your Firebase console
// (Project settings > General > Your apps > SDK setup and configuration).
//
// These values are NOT secret. They only tell the page which Firebase
// project to use. Real security comes from database.rules.json.
// Never put a "service account" or "admin" key in this project.
// ------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfHJ0EEsucv8bNMgW2UHeKiFXdZyoL080",
  authDomain: "grammar-game-d7b09.firebaseapp.com",
  databaseURL: "https://grammar-game-d7b09-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "grammar-game-d7b09",
  storageBucket: "grammar-game-d7b09.firebasestorage.app",
  messagingSenderId: "518946365409",
  appId: "1:518946365409:web:ef9a1d6a5a7c7bbd5d7ca0"
};

// True until you paste your own settings above.
export const configMissing = firebaseConfig.apiKey.startsWith("PASTE");

// Every page says what it is, for example <body data-role="teacher">.
// Teacher, student and check pages keep SEPARATE logins in the same browser,
// so you can test a teacher tab and a student tab side by side.
// To test several students on one computer, open student.html?slot=2, ?slot=3, ...
const role = document.body.dataset.role || "student";
export const slotId = new URLSearchParams(location.search).get("slot") || "";

let auth = null;
let db = null;
if (!configMissing) {
  const app = initializeApp(firebaseConfig, role + slotId);
  auth = getAuth(app);
  db = getDatabase(app);
}
export { auth, db };
