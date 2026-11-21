
// ------------------------------------------------------------
// js/teacher.js — Phase 6
// - Teacher login and logout
// - Settings and class sections
// - Question Bank integration
// - Completed Game History
// - Dashboard statistics and recent sessions
// - Game history filters, participant details and performance reports
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
import { startQuestionBank, stopQuestionBank } from "./questions.js";

const $ = (id) => document.getElementById(id);

if (configMissing) {
  showScreen("configScreen");
  throw new Error("Firebase settings are missing. Edit js/firebase-config.js");
}

// ---------- Settings ----------
const SECTION_PAGES = [
  "dashboard",
  "questions",
  "create",
  "history",
  "reports",
  "settings"
];

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
let classSections = [];
let unsubSettings = null;
let unsubHistory = null;
let formFilled = false;
let navReady = false;
let editingId = null;
let editingValue = "";

let historyGames = [];
let selectedHistoryId = null;

// ---------- Paths ----------
function settingsPath() {
  return "teachers/" + user.uid + "/settings";
}

function historyPath() {
  return "gameHistory/" + user.uid;
}

// ============================================================
// LOGIN AND LOGOUT
// ============================================================

function friendlyAuthError(err) {
  const code = (err && err.code) || "";

  if (
    code.includes("invalid-credential") ||
    code.includes("wrong-password") ||
    code.includes("user-not-found") ||
    code.includes("invalid-email")
  ) {
    return "Wrong email or password.";
  }

  if (code.includes("too-many-requests")) {
    return "Too many tries. Please wait a minute and try again.";
  }

  if (code.includes("network")) {
    return "No internet connection.";
  }

  return "Could not log in: " + ((err && err.message) || code);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  $("loginError").textContent = "";
  $("loginBtn").disabled = true;

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );
  } catch (err) {
    $("loginError").textContent = friendlyAuthError(err);
  } finally {
    $("loginBtn").disabled = false;
  }
});

async function logout() {
  stopQuestionBank();

  if (unsubSettings) {
    unsubSettings();
    unsubSettings = null;
  }

  if (unsubHistory) {
    unsubHistory();
    unsubHistory = null;
  }

  await signOut(auth);
}

$("logoutBtn").addEventListener("click", logout);
$("deniedLogout").addEventListener("click", logout);

onAuthStateChanged(auth, async (u) => {
  if (!u) {
    stopQuestionBank();

    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }

    if (unsubHistory) {
      unsubHistory();
      unsubHistory = null;
    }

    user = null;
    historyGames = [];
    $("password").value = "";
    showScreen("loginScreen");
    return;
  }

  if (u.isAnonymous) {
    await signOut(auth);
    return;
  }

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
  selectedHistoryId = null;

  $("appError").classList.add("hidden");
  showScreen("appScreen");

  $("statQuestions").textContent = "0";

  startQuestionBank(user.uid, (count) => {
    $("statQuestions").textContent = count;
  });

  if (unsubSettings) unsubSettings();

  unsubSettings = onValue(
    ref(db, settingsPath()),
    (snap) => {
      $("appError").classList.add("hidden");

      const value = snap.val() || {};

      settings = readSettings(value);

      classSections = Object.entries(value.sections || {})
        .map(([id, name]) => ({
          id,
          name: String(name)
        }))
        .sort((a, b) =>
          a.name.localeCompare(
            b.name,
            undefined,
            { numeric: true, sensitivity: "base" }
          )
        );

      if (!formFilled) {
        fillSettingsForm();
        formFilled = true;
      }

      renderHeaderInfo();
      renderSections();
    },
    () => {
      $("appError").textContent =
        "Could not read your settings. Make sure the newest database rules are published in Firebase, then reload this page.";

      $("appError").classList.remove("hidden");
    }
  );

  startHistoryListener();

  if (!navReady) {
    window.addEventListener("hashchange", showSection);
    navReady = true;
  }

  showSection();
}

function readSettings(value) {
  const s = { ...DEFAULTS };

  if (typeof value.displayName === "string") {
    s.displayName = value.displayName;
  }

  if (typeof value.defaultTimer === "number") {
    s.defaultTimer = value.defaultTimer;
  }

  if (
    value.defaultMode === "classic" ||
    value.defaultMode === "speed"
  ) {
    s.defaultMode = value.defaultMode;
  }

  if (typeof value.showResultsEachQuestion === "boolean") {
    s.showResultsEachQuestion = value.showResultsEachQuestion;
  }

  return s;
}

function showSection() {
  let name = location.hash.replace("#", "");

  if (!SECTION_PAGES.includes(name)) {
    name = "dashboard";
  }

  document.querySelectorAll(".section").forEach((s) => {
    s.classList.toggle("hidden", s.id !== "sec-" + name);
  });

  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.section === name) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });

  document.body.classList.remove("menu-open");
  window.scrollTo(0, 0);
}

// Phone menu
$("menuBtn").addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

$("scrim").addEventListener("click", () => {
  document.body.classList.remove("menu-open");
});

function renderHeaderInfo() {
  const name = settings.displayName || user.email || "Teacher";

  $("userName").textContent = name;
  $("welcome").textContent = "Welcome back, " + name;
  $("statSections").textContent = classSections.length;
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
    await update(ref(db, settingsPath()), data);
    setStatus("Saved.", false);
  } catch (err) {
    setStatus("Could not save: " + (err.message || err), true);
  } finally {
    $("saveSettingsBtn").disabled = false;
  }
});

// ============================================================
// SETTINGS: CLASS SECTIONS
// ============================================================

function sectionExists(name, exceptId) {
  return classSections.some(
    (s) =>
      s.id !== exceptId &&
      s.name.toLowerCase() === name.toLowerCase()
  );
}

function sectionMessage(text) {
  $("sectionMsg").textContent = text || "";
}

$("addSectionForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  sectionMessage("");

  const name = cleanText($("newSection").value, 30);

  if (!name) {
    sectionMessage("Please type a section name.");
    return;
  }

  if (sectionExists(name, null)) {
    sectionMessage("That section is already in the list.");
    return;
  }

  if (classSections.length >= MAX_SECTIONS) {
    sectionMessage("You can have up to " + MAX_SECTIONS + " sections.");
    return;
  }

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
    list.appendChild(
      h("p", "muted", "No sections yet. Add your first one, for example 10-Newton.")
    );
    return;
  }

  classSections.forEach((s) => {
    const row = h("div", "list-row");

    if (editingId === s.id) {
      const input = h("input", "");

      input.type = "text";
      input.maxLength = 30;
      input.value = editingValue;
      input.setAttribute("aria-label", "Section name");

      input.addEventListener("input", () => {
        editingValue = input.value;
      });

      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          saveRename(s.id);
        }

        if (ev.key === "Escape") {
          cancelRename();
        }
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

  if (!name) {
    sectionMessage("The section name cannot be empty.");
    return;
  }

  if (sectionExists(name, id)) {
    sectionMessage("That section is already in the list.");
    return;
  }

  try {
    await set(ref(db, settingsPath() + "/sections/" + id), name);
    editingId = null;
    renderSections();
  } catch (err) {
    sectionMessage("Could not rename the section: " + (err.message || err));
  }
}

// ============================================================
// PHASE 6: GAME HISTORY LISTENER
// ============================================================

function startHistoryListener() {
  if (unsubHistory) {
    unsubHistory();
    unsubHistory = null;
  }

  historyGames = [];

  unsubHistory = onValue(
    ref(db, historyPath()),
    (snap) => {
      const data = snap.val() || {};

      historyGames = Object.entries(data)
        .map(([id, game]) => ({
          id,
          ...game
        }))
        .filter((game) => game.status === "finished")
        .sort((a, b) =>
          (Number(b.finishedAt) || 0) -
          (Number(a.finishedAt) || 0)
        );

      renderHistory();
      renderPerformanceReports();
      renderDashboardHistory();
      renderDashboardStats();
    },
    (error) => {
      const message =
        "Could not load game history. Check that your Firebase gameHistory read rules are published.";

      showHistoryError(message);
      console.error("Game history read error:", error);
    }
  );
}

function showHistoryError(message) {
  const section = $("sec-history");

  let notice = $("historyLoadError");

  if (!notice) {
    notice = document.createElement("div");
    notice.id = "historyLoadError";
    notice.className = "notice";
    section.prepend(notice);
  }

  notice.textContent = message;
  notice.classList.remove("hidden");
}

// ============================================================
// PHASE 6: HISTORY HELPERS
// ============================================================

function formatDate(timestamp) {
  const value = Number(timestamp);

  if (!value || !Number.isFinite(value)) {
    return "Date unavailable";
  }

  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function modeLabel(mode) {
  if (mode === "speed") return "Speed Battle";
  if (mode === "classic") return "Classic Quiz";
  return mode || "Unknown";
}

function getPlayers(game) {
  const players = game.players || {};

  return Object.entries(players)
    .map(([uid, player]) => ({
      uid,
      name: String(player.name || "Student"),
      section: String(player.section || "No section"),
      score: Number(player.score) || 0,
      correct: Number(player.correct) || 0,
      answered: Number(player.answered) || 0,
      rank: Number(player.rank) || 0
    }))
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      return b.score - a.score;
    });
}

function createTextElement(tag, className, text) {
  const el = document.createElement(tag);

  if (className) el.className = className;
  el.textContent = text == null ? "" : String(text);

  return el;
}

function createSelect(id, labelText, options) {
  const label = document.createElement("label");
  label.textContent = labelText;

  const select = document.createElement("select");
  select.id = id;

  options.forEach((option) => {
    const item = document.createElement("option");

    item.value = option.value;
    item.textContent = option.label;

    select.appendChild(item);
  });

  label.appendChild(select);

  return label;
}

// ============================================================
// PHASE 6: GAME HISTORY UI
// ============================================================

function prepareHistorySection() {
  const section = $("sec-history");

  if ($("historyList")) return;

  section.replaceChildren();

  const header = document.createElement("header");
  header.className = "page-head";

  header.appendChild(createTextElement("h1", "", "Game History"));
  header.appendChild(
    createTextElement(
      "p",
      "muted",
      "Review your completed games, participants and final results."
    )
  );

  const filters = document.createElement("div");
  filters.className = "card";

  const filterGrid = document.createElement("div");
  filterGrid.className = "toolbar-grid";

  filterGrid.append(
    createSelect("historyGradeFilter", "Grade", [
      { value: "", label: "All grades" },
      { value: "10", label: "Grade 10" },
      { value: "11", label: "Grade 11" },
      { value: "12", label: "Grade 12" }
    ]),
    createSelect("historyTopicFilter", "Topic", [
      { value: "", label: "All topics" }
    ]),
    createSelect("historyModeFilter", "Mode", [
      { value: "", label: "All modes" },
      { value: "classic", label: "Classic Quiz" },
      { value: "speed", label: "Speed Battle" }
    ])
  );

  filters.appendChild(filterGrid);

  const count = createTextElement("p", "muted", "");
  count.id = "historyCount";
  filters.appendChild(count);

  const list = document.createElement("div");
  list.id = "historyList";

  section.append(header, filters, list);

  ["historyGradeFilter", "historyTopicFilter", "historyModeFilter"]
    .forEach((id) => {
      $(id).addEventListener("change", renderHistory);
    });
}

function updateTopicFilter() {
  const select = $("historyTopicFilter");
  if (!select) return;

  const previous = select.value;

  const topics = [
    ...new Set(
      historyGames
        .map((game) => String(game.topic || "").trim())
        .filter(Boolean)
    )
  ].sort((a, b) => a.localeCompare(b));

  select.replaceChildren();

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All topics";
  select.appendChild(all);

  topics.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    select.appendChild(option);
  });

  if (topics.includes(previous)) {
    select.value = previous;
  }
}

function getFilteredGames() {
  const grade = $("historyGradeFilter")?.value || "";
  const topic = $("historyTopicFilter")?.value || "";
  const mode = $("historyModeFilter")?.value || "";

  return historyGames.filter((game) => {
    if (grade && String(game.grade) !== grade) return false;
    if (topic && String(game.topic || "") !== topic) return false;
    if (mode && String(game.mode || "") !== mode) return false;

    return true;
  });
}

function renderHistory() {
  prepareHistorySection();
  updateTopicFilter();

  const list = $("historyList");
  const count = $("historyCount");

  list.replaceChildren();

  const games = getFilteredGames();

  count.textContent =
    games.length + (games.length === 1 ? " completed game" : " completed games");

  if (historyGames.length === 0) {
    list.appendChild(
      createTextElement(
        "div",
        "card muted",
        "No completed games yet. Your finished games will appear here automatically."
      )
    );
    return;
  }

  if (games.length === 0) {
    list.appendChild(
      createTextElement(
        "div",
        "card muted",
        "No games match these filters. Try changing or clearing your filters."
      )
    );
    return;
  }

  games.forEach((game) => {
    const card = document.createElement("div");
    card.className = "card";

    const heading = document.createElement("div");
    heading.className = "page-head-row";

    const titleArea = document.createElement("div");

    titleArea.appendChild(
      createTextElement(
        "h2",
        "",
        game.topic || "Untitled topic"
      )
    );

    titleArea.appendChild(
      createTextElement(
        "p",
        "muted",
        "Grade " + (game.grade || "—") +
        " · " + modeLabel(game.mode)
      )
    );

    heading.appendChild(titleArea);

    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.className = "btn small ghost";

    const isSelected = selectedHistoryId === game.id;
    detailsButton.textContent = isSelected ? "Hide Details" : "View Details";

    detailsButton.addEventListener("click", () => {
      selectedHistoryId = isSelected ? null : game.id;
      renderHistory();
    });

    heading.appendChild(detailsButton);
    card.appendChild(heading);

    const info = document.createElement("div");
    info.className = "toolbar-grid";

    info.append(
      createTextElement(
        "p",
        "",
        "Finished: " + formatDate(game.finishedAt)
      ),
      createTextElement(
        "p",
        "",
        "Questions: " + (Number(game.questionCount) || 0)
      ),
      createTextElement(
        "p",
        "",
        "Timer: " + (Number(game.timer) || 0) + " seconds"
      ),
      createTextElement(
        "p",
        "",
        "Participants: " + (Number(game.playerCount) || 0)
      )
    );

    card.appendChild(info);

    if (isSelected) {
      card.appendChild(createPlayerDetails(game));
    }

    list.appendChild(card);
  });
}

function createPlayerDetails(game) {
  const wrapper = document.createElement("div");
  wrapper.className = "card";

  wrapper.appendChild(
    createTextElement("h3", "", "Final Results")
  );

  const players = getPlayers(game);

  if (players.length === 0) {
    wrapper.appendChild(
      createTextElement(
        "p",
        "muted",
        "No participant details were saved for this game."
      )
    );

    return wrapper;
  }

  const table = document.createElement("table");
  table.className = "history-results-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  [
    "Rank",
    "Student",
    "Section",
    "Score",
    "Correct",
    "Answered"
  ].forEach((label) => {
    headerRow.appendChild(createTextElement("th", "", label));
  });

  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");

  players.forEach((player, index) => {
    const row = document.createElement("tr");

    const rank = player.rank || index + 1;

    [
      "#" + rank,
      player.name,
      player.section,
      player.score,
      player.correct,
      player.answered
    ].forEach((value) => {
      row.appendChild(createTextElement("td", "", value));
    });

    tbody.appendChild(row);
  });

  table.append(thead, tbody);
  wrapper.appendChild(table);

  return wrapper;
}

// ============================================================
// PHASE 6: DASHBOARD
// ============================================================

function renderDashboardStats() {
  const uniqueStudents = new Set();
  const uniqueSections = new Set();

  historyGames.forEach((game) => {
    Object.entries(game.players || {}).forEach(([uid, player]) => {
      uniqueStudents.add(uid);

      const section = String(player.section || "").trim();

      if (section && section !== "No section") {
        uniqueSections.add(section);
      }
    });
  });

  $("statGames").textContent = historyGames.length;
  $("statStudents").textContent = uniqueStudents.size;

  // Keep the existing settings section count.
  $("statSections").textContent = classSections.length;
}

function renderDashboardHistory() {
  const dashboard = $("sec-dashboard");

  const cards = [...dashboard.querySelectorAll(".card")];

  const recentCard = cards.find((card) =>
    card.querySelector("h2")?.textContent.includes("Recent game sessions")
  );

  if (!recentCard) return;

  const heading = recentCard.querySelector("h2");

  recentCard.replaceChildren();

  if (heading) {
    recentCard.appendChild(heading);
  } else {
    recentCard.appendChild(
      createTextElement("h2", "", "Recent game sessions")
    );
  }

  if (historyGames.length === 0) {
    recentCard.appendChild(
      createTextElement(
        "p",
        "muted",
        "No completed games yet. Your finished games will appear here."
      )
    );
    return;
  }

  historyGames.slice(0, 5).forEach((game) => {
    const row = document.createElement("div");
    row.className = "list-row";

    const info = document.createElement("div");

    info.appendChild(
      createTextElement(
        "strong",
        "",
        game.topic || "Untitled topic"
      )
    );

    info.appendChild(
      createTextElement(
        "p",
        "muted small-text",
        "Grade " + (game.grade || "—") +
        " · " + modeLabel(game.mode) +
        " · " + formatDate(game.finishedAt)
      )
    );

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn small ghost";
    button.textContent = "View";

    button.addEventListener("click", () => {
      location.hash = "#history";
      selectedHistoryId = game.id;
      renderHistory();
    });

    row.append(info, button);
    recentCard.appendChild(row);
  });
}


// ============================================================
// PHASE 6: PERFORMANCE REPORTS
// Reports are calculated from completed games in gameHistory.
// ============================================================

function prepareReportsSection() {
  const section = $("sec-reports");
  if (!section || $("reportSummary")) return;

  section.replaceChildren();

  const header = document.createElement("header");
  header.className = "page-head";
  header.append(
    createTextElement("h1", "", "Performance Reports"),
    createTextElement(
      "p",
      "muted",
      "Analyze student results from your completed games."
    )
  );

  const filters = document.createElement("div");
  filters.className = "card";
  const filterGrid = document.createElement("div");
  filterGrid.className = "toolbar-grid";

  filterGrid.append(
    createSelect("reportGradeFilter", "Grade", [
      { value: "", label: "All grades" },
      { value: "10", label: "Grade 10" },
      { value: "11", label: "Grade 11" },
      { value: "12", label: "Grade 12" }
    ]),
    createSelect("reportSectionFilter", "Section", [
      { value: "", label: "All sections" }
    ]),
    createSelect("reportTopicFilter", "Topic", [
      { value: "", label: "All topics" }
    ])
  );

  filters.appendChild(filterGrid);

  const summary = document.createElement("div");
  summary.id = "reportSummary";
  summary.className = "stats-grid";

  const studentResults = document.createElement("div");
  studentResults.id = "reportStudentResults";
  studentResults.className = "card";

  section.append(
    header,
    filters,
    summary,
    studentResults
  );

  [
    "reportGradeFilter",
    "reportSectionFilter",
    "reportTopicFilter"
  ].forEach((id) => {
    $(id).addEventListener("change", renderPerformanceReports);
  });
}

function getReportGames() {
  const grade = $("reportGradeFilter")?.value || "";
  const section = $("reportSectionFilter")?.value || "";
  const topic = $("reportTopicFilter")?.value || "";

  return historyGames.filter((game) => {
    if (grade && String(game.grade || "") !== grade) return false;
    if (topic && String(game.topic || "") !== topic) return false;

    if (section) {
      const hasSection = getPlayers(game).some(
        (player) => player.section === section
      );
      if (!hasSection) return false;
    }

    return true;
  });
}

function updateReportFilters() {
  const sectionSelect = $("reportSectionFilter");
  const topicSelect = $("reportTopicFilter");
  if (!sectionSelect || !topicSelect) return;

  const previousSection = sectionSelect.value;
  const previousTopic = topicSelect.value;

  const selectedGrade = $("reportGradeFilter").value;
  const relevantGames = historyGames.filter((game) =>
    !selectedGrade || String(game.grade || "") === selectedGrade
  );

  const sections = [...new Set(
    relevantGames.flatMap((game) =>
      getPlayers(game)
        .map((player) => player.section)
        .filter((name) => name && name !== "No section")
    )
  )].sort((a, b) => a.localeCompare(b));

  const topics = [...new Set(
    relevantGames
      .map((game) => String(game.topic || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  sectionSelect.replaceChildren();
  const allSections = document.createElement("option");
  allSections.value = "";
  allSections.textContent = "All sections";
  sectionSelect.appendChild(allSections);

  sections.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    sectionSelect.appendChild(option);
  });

  topicSelect.replaceChildren();
  const allTopics = document.createElement("option");
  allTopics.value = "";
  allTopics.textContent = "All topics";
  topicSelect.appendChild(allTopics);

  topics.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    topicSelect.appendChild(option);
  });

  if (sections.includes(previousSection)) {
    sectionSelect.value = previousSection;
  }
  if (topics.includes(previousTopic)) {
    topicSelect.value = previousTopic;
  }
}

function createReportMetric(label, value) {
  const card = document.createElement("div");
  card.className = "card";
  card.append(
    createTextElement("p", "muted", label),
    createTextElement("h2", "", value)
  );
  return card;
}

function renderPerformanceReports() {
  prepareReportsSection();
  updateReportFilters();

  const games = getReportGames();
  const summary = $("reportSummary");
  const results = $("reportStudentResults");

  summary.replaceChildren();
  results.replaceChildren();

  const students = new Map();
  let totalScore = 0;
  let totalCorrect = 0;
  let totalAnswered = 0;
  let totalQuestions = 0;
  let participantEntries = 0;

  games.forEach((game) => {
    totalQuestions += Number(game.questionCount) || 0;

    getPlayers(game)
      .filter((player) =>
        !$("reportSectionFilter").value ||
        player.section === $("reportSectionFilter").value
      )
      .forEach((player) => {
      participantEntries++;
      totalScore += player.score;
      totalCorrect += player.correct;
      totalAnswered += player.answered;

      const key = player.uid || (player.name + "|" + player.section);
      if (!students.has(key)) {
        students.set(key, {
          name: player.name,
          section: player.section,
          games: 0,
          score: 0,
          correct: 0,
          answered: 0
        });
      }

      const student = students.get(key);
      student.games++;
      student.score += player.score;
      student.correct += player.correct;
      student.answered += player.answered;
    });
  });

  const uniqueStudents = students.size;
  const averageScore = participantEntries
    ? Math.round(totalScore / participantEntries)
    : 0;
  const accuracy = totalAnswered
    ? Math.round((totalCorrect / totalAnswered) * 100)
    : 0;

  summary.append(
    createReportMetric("Completed games", String(games.length)),
    createReportMetric("Student participants", String(uniqueStudents)),
    createReportMetric("Average score per game entry", String(averageScore)),
    createReportMetric("Answer accuracy", accuracy + "%")
  );

  results.appendChild(
    createTextElement("h2", "", "Student Performance")
  );

  if (games.length === 0 || students.size === 0) {
    results.appendChild(
      createTextElement(
        "p",
        "muted",
        "No participant results match these filters yet."
      )
    );
    return;
  }

  const ranked = [...students.values()]
    .map((student) => ({
      ...student,
      averageScore: student.games
        ? Math.round(student.score / student.games)
        : 0,
      accuracy: student.answered
        ? Math.round((student.correct / student.answered) * 100)
        : 0
    }))
    .sort((a, b) =>
      b.averageScore - a.averageScore ||
      b.accuracy - a.accuracy ||
      a.name.localeCompare(b.name)
    );

  const table = document.createElement("table");
  table.className = "history-results-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [
    "Rank",
    "Student",
    "Section",
    "Games",
    "Average Score",
    "Accuracy"
  ].forEach((label) => {
    headerRow.appendChild(createTextElement("th", "", label));
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  ranked.forEach((student, index) => {
    const row = document.createElement("tr");
    [
      "#" + (index + 1),
      student.name,
      student.section,
      student.games,
      student.averageScore,
      student.accuracy + "%"
    ].forEach((value) => {
      row.appendChild(createTextElement("td", "", value));
    });
    tbody.appendChild(row);
  });

  table.append(thead, tbody);
  results.appendChild(table);

  results.appendChild(
    createTextElement(
      "p",
      "muted small-text",
      "Average score is calculated from each student's saved game scores. Accuracy is correct answers divided by answered questions."
    )
  );
}

// ============================================================
// INITIAL HISTORY AND REPORTS UI SETUP
// ============================================================

prepareHistorySection();
prepareReportsSection();
