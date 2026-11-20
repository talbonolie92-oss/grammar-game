// ------------------------------------------------------------
// js/teacher.js  (Phase 2)
// - Teacher login and logout
// - Checks that the account is on the allowedTeachers list
// - Navigation between the six sections
// - Dashboard greeting and counts
// - Settings: game defaults and class sections
// ------------------------------------------------------------
import { auth, db, configMissing } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, onValue, get, set, update, remove, push
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { h, showScreen, cleanText } from "./common.js";

const $ = (id) => document.getElementById(id);

// If firebase-config.js still has the PASTE_ values, stop here.
if (configMissing) {
  showScreen("configScreen");
  throw new Error("Firebase settings are missing. Edit js/firebase-config.js");
}

// ---------- Settings ----------
const SECTION_PAGES = ["dashboard", "questions", "create", "history", "reports", "settings"];
const DEFAULTS = {
  displayName: "",
  defaultTimer: 20,
  defaultMode: "classic",
  showResultsEachQuestion: true
};
const MAX_SECTIONS = 30;

// ---------- State ----------
let user = null;
let settings = { ...DEFAULTS };
let classSections = [];        // [{ id, name }]
let unsubSettings = null;
let formFilled = false;        // fill the settings form only once, so typing is never overwritten
let navReady = false;
let editingId = null;          // which class section is being renamed
let editingValue = "";

function settingsPath() {
  return "teachers/" + user.uid + "/settings";
}

// ============================================================
// LOGIN AND LOGOUT
// ============================================================
function friendlyAuthError(err) {
  const code = (err && err.code) || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-email")) {
    return "Wrong email or password.";
  }
  if (code.includes("too-many-requests")) return "Too many tries. Please wait a minute and try again.";
  if (code.includes("network")) return "No internet connection.";
  return "Could not log in: " + ((err && err.message) || code);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").textContent = "";
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    $("loginError").textContent = friendlyAuthError(err);
  } finally {
    $("loginBtn").disabled = false;
  }
});

async function logout() {
  if (unsubSettings) { unsubSettings(); unsubSettings = null; }
  await signOut(auth);
}
$("logoutBtn").addEventListener("click", logout);
$("deniedLogout").addEventListener("click", logout);

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    user = null;
    $("password").value = "";
    showScreen("loginScreen");
    return;
  }

  // Students sign in anonymously. They must never see the teacher area.
  if (u.isAnonymous) {
    await signOut(auth);
    return;
  }

  // Is this account on the allowedTeachers list?
  let allowed = false;
  try {
    const snap = await get(ref(db, "allowedTeachers/" + u.uid));
    allowed = snap.val() === true;
  } catch (err) {
    allowed = false;
  }
  if (!allowed) {
    $("myUid").textContent = u.uid;
    showScreen("deniedScreen");
    return;
  }

  user = u;
  startApp();
});

// ============================================================
// APP START AND NAVIGATION
// ============================================================
function startApp() {
  formFilled = false;
  editingId = null;
  $("appError").classList.add("hidden");
  showScreen("appScreen");

  if (unsubSettings) unsubSettings();
  unsubSettings = onValue(
    ref(db, settingsPath()),
    (snap) => {
      $("appError").classList.add("hidden");
      const value = snap.val() || {};
      settings = readSettings(value);
      classSections = Object.entries(value.sections || {})
        .map(([id, name]) => ({ id, name: String(name) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

      if (!formFilled) { fillSettingsForm(); formFilled = true; }
      renderHeaderInfo();
      renderSections();
    },
    () => {
      $("appError").textContent =
        "Could not read your settings. Make sure the newest database rules are published in Firebase, then reload this page.";
      $("appError").classList.remove("hidden");
    }
  );

  if (!navReady) {
    window.addEventListener("hashchange", showSection);
    navReady = true;
  }
  showSection();
}

// Keeps only the settings we know about, with safe defaults.
function readSettings(value) {
  const s = { ...DEFAULTS };
  if (typeof value.displayName === "string") s.displayName = value.displayName;
  if (typeof value.defaultTimer === "number") s.defaultTimer = value.defaultTimer;
  if (value.defaultMode === "classic" || value.defaultMode === "speed") s.defaultMode = value.defaultMode;
  if (typeof value.showResultsEachQuestion === "boolean") s.showResultsEachQuestion = value.showResultsEachQuestion;
  return s;
}

// Shows the section named in the address bar (for example #settings).
function showSection() {
  let name = location.hash.replace("#", "");
  if (!SECTION_PAGES.includes(name)) name = "dashboard";

  document.querySelectorAll(".section").forEach((s) => {
    s.classList.toggle("hidden", s.id !== "sec-" + name);
  });
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.section === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.body.classList.remove("menu-open");
  window.scrollTo(0, 0);
}

// Phone menu
$("menuBtn").addEventListener("click", () => document.body.classList.toggle("menu-open"));
$("scrim").addEventListener("click", () => document.body.classList.remove("menu-open"));

function renderHeaderInfo() {
  const name = settings.displayName || user.email || "Teacher";
  $("userName").textContent = name;
  $("welcome").textContent = "Welcome back, " + name;
  $("statSections").textContent = classSections.length;
  // Phase 3 will fill statQuestions, Phase 6 will fill statGames and statStudents.
}

// ============================================================
// SETTINGS: GAME DEFAULTS
// ============================================================
function fillSettingsForm() {
  $("displayName").value = settings.displayName;
  $("defaultTimer").value = settings.defaultTimer;
  $("defaultMode").value = settings.defaultMode;
  $("showResults").checked = settings.showResultsEachQuestion;
}

function setStatus(text, isError) {
  const el = $("saveStatus");
  el.textContent = text;
  el.className = "status" + (isError ? " bad" : " good");
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const timer = Math.round(Number($("defaultTimer").value));
  if (!(timer >= 5 && timer <= 120)) {
    setStatus("Time must be between 5 and 120 seconds.", true);
    return;
  }

  const data = {
    displayName: cleanText($("displayName").value, 60),
    defaultTimer: timer,
    defaultMode: $("defaultMode").value,
    showResultsEachQuestion: $("showResults").checked
  };

  $("saveSettingsBtn").disabled = true;
  setStatus("Saving…", false);
  try {
    // update() changes only these four fields and leaves the class sections alone.
    await update(ref(db, settingsPath()), data);
    setStatus("Saved.", false);
  } catch (err) {
    setStatus("Could not save: " + (err.message || err), true);
  } finally {
    $("saveSettingsBtn").disabled = false;
  }
});

// ============================================================
// SETTINGS: CLASS SECTIONS (add, rename, remove)
// ============================================================
function sectionExists(name, exceptId) {
  return classSections.some(
    (s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase()
  );
}

function sectionMessage(text) {
  $("sectionMsg").textContent = text || "";
}

$("addSectionForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  sectionMessage("");
  const name = cleanText($("newSection").value, 30);

  if (!name) { sectionMessage("Please type a section name."); return; }
  if (sectionExists(name, null)) { sectionMessage("That section is already in the list."); return; }
  if (classSections.length >= MAX_SECTIONS) { sectionMessage("You can have up to " + MAX_SECTIONS + " sections."); return; }

  try {
    await set(push(ref(db, settingsPath() + "/sections")), name);
    $("newSection").value = "";
    $("newSection").focus();
  } catch (err) {
    sectionMessage("Could not add the section: " + (err.message || err));
  }
});

function renderSections() {
  const list = $("sectionList");
  list.replaceChildren();

  if (classSections.length === 0) {
    list.appendChild(h("p", "muted", "No sections yet. Add your first one, for example 10-Newton."));
    return;
  }

  classSections.forEach((s) => {
    const row = h("div", "list-row");

    if (editingId === s.id) {
      // Rename mode
      const input = h("input", "");
      input.type = "text";
      input.maxLength = 30;
      input.value = editingValue;
      input.setAttribute("aria-label", "Section name");
      input.addEventListener("input", () => { editingValue = input.value; });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); saveRename(s.id); }
        if (ev.key === "Escape") { cancelRename(); }
      });

      const save = h("button", "btn small", "Save");
      save.type = "button";
      save.addEventListener("click", () => saveRename(s.id));

      const cancel = h("button", "btn small ghost", "Cancel");
      cancel.type = "button";
      cancel.addEventListener("click", cancelRename);

      row.append(input, save, cancel);
      list.appendChild(row);
      setTimeout(() => input.focus(), 0);
    } else {
      // Normal mode
      const edit = h("button", "btn small ghost", "Rename");
      edit.type = "button";
      edit.addEventListener("click", () => {
        editingId = s.id;
        editingValue = s.name;
        sectionMessage("");
        renderSections();
      });

      const del = h("button", "btn small danger", "Remove");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("Remove the section “" + s.name + "”?")) return;
        try {
          await remove(ref(db, settingsPath() + "/sections/" + s.id));
        } catch (err) {
          sectionMessage("Could not remove the section: " + (err.message || err));
        }
      });

      row.append(h("span", "name", s.name), edit, del);
      list.appendChild(row);
    }
  });
}

function cancelRename() {
  editingId = null;
  sectionMessage("");
  renderSections();
}

async function saveRename(id) {
  sectionMessage("");
  const name = cleanText(editingValue, 30);
  if (!name) { sectionMessage("The section name cannot be empty."); return; }
  if (sectionExists(name, id)) { sectionMessage("That section is already in the list."); return; }

  try {
    await set(ref(db, settingsPath() + "/sections/" + id), name);
    editingId = null;
    renderSections();
  } catch (err) {
    sectionMessage("Could not rename the section: " + (err.message || err));
  }
}
