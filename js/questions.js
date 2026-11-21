// ------------------------------------------------------------
// js/questions.js  (Phase 3)
// The Question Bank screen:
//   - loads this teacher's questions from Firebase (live)
//   - add / edit / delete questions
//   - search, and filter by grade and topic
// Questions are saved at:  teachers/{your user ID}/questions/{question ID}
// The rules in database.rules.json let only you read or write that path.
// ------------------------------------------------------------
import { db } from "./firebase-config.js";
import {
  ref, onValue, set, push, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { h } from "./common.js";
import {
  LETTERS, validateQuestion, filterQuestions, collectTopics,
  allTopicOptions, canonicalTopic, sortNewestFirst, gradeLabel
} from "./question-logic.js";

const $ = (id) => document.getElementById(id);

const CHOICE_IDS = ["qbChoice0", "qbChoice1", "qbChoice2", "qbChoice3"];
const RADIO_IDS = ["qbCorrect0", "qbCorrect1", "qbCorrect2", "qbCorrect3"];
const FORM_FIELD_IDS = ["qbGrade", "qbTopic", "qbText", ...CHOICE_IDS];

// ---------- State ----------
let uid = null;
let unsubscribe = null;
let onCount = null;          // tells the dashboard how many questions there are
let questions = [];          // all saved questions, newest first
let loaded = false;
let editingId = null;        // id of the question in the form (null = adding a new one)
let confirmingId = null;     // id of the question waiting for "Yes, delete"
let saving = false;
let wired = false;
let lastGrade = "";          // remembered so adding many questions is quicker
let lastTopic = "";
const filters = { search: "", grade: "", topic: "" };

function basePath() {
  return "teachers/" + uid + "/questions";
}

// ============================================================
// START AND STOP (called by teacher.js)
// ============================================================
export function startQuestionBank(teacherUid, countCallback) {
  stopQuestionBank();
  uid = teacherUid;
  onCount = countCallback || null;
  wireOnce();
  $("qbLoadError").classList.add("hidden");

  unsubscribe = onValue(
    ref(db, basePath()),
    (snap) => {
      const value = snap.val() || {};
      questions = sortNewestFirst(Object.entries(value).map(([id, q]) => normalize(id, q)));
      loaded = true;
      $("qbLoadError").classList.add("hidden");
      refreshTopicControls();
      renderList();
      if (onCount) onCount(questions.length);
    },
    () => {
      $("qbLoadError").textContent =
        "Could not load your questions. Make sure the newest database rules are published in Firebase, then reload this page.";
      $("qbLoadError").classList.remove("hidden");
    }
  );
}

export function stopQuestionBank() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  uid = null;
  questions = [];
  loaded = false;
  editingId = null;
  confirmingId = null;
  saving = false;
  filters.search = "";
  filters.grade = "";
  filters.topic = "";
  if (wired) {
    $("qbSearch").value = "";
    $("qbGradeFilter").value = "";
    $("qbTopicFilter").value = "";
    $("qbFormCard").classList.add("hidden");
    $("qbNotice").classList.add("hidden");
    $("qbList").replaceChildren();
    $("qbCount").textContent = "";
  }
}

// Turns raw Firebase data into a tidy question object.
function normalize(id, q) {
  return {
    id,
    grade: Number(q.grade),
    topic: String(q.topic || ""),
    text: String(q.text || ""),
    choices: Object.values(q.choices || {}).map(String),
    correctIndex: Number(q.correctIndex),
    explanation: q.explanation ? String(q.explanation) : "",
    createdAt: Number(q.createdAt) || 0
  };
}

// ============================================================
// BUTTONS AND INPUTS (connected only once)
// ============================================================
function wireOnce() {
  if (wired) return;
  wired = true;

  $("qbAddBtn").addEventListener("click", () => openForm(null));
  $("qbCancel").addEventListener("click", closeForm);
  $("qbForm").addEventListener("submit", saveQuestion);

  $("qbSearch").addEventListener("input", () => {
    filters.search = $("qbSearch").value;
    renderList();
  });
  $("qbGradeFilter").addEventListener("change", () => {
    filters.grade = $("qbGradeFilter").value;
    renderList();
  });
  $("qbTopicFilter").addEventListener("change", () => {
    filters.topic = $("qbTopicFilter").value;
    renderList();
  });
  $("qbClear").addEventListener("click", () => {
    filters.search = "";
    filters.grade = "";
    filters.topic = "";
    $("qbSearch").value = "";
    $("qbGradeFilter").value = "";
    $("qbTopicFilter").value = "";
    renderList();
  });

  // Remove the red "needs attention" mark as soon as the teacher fixes a field.
  FORM_FIELD_IDS.forEach((id) => {
    const el = $(id);
    const clear = () => el.removeAttribute("aria-invalid");
    el.addEventListener("input", clear);
    el.addEventListener("change", clear);
  });
}

// ============================================================
// MESSAGES
// ============================================================
function friendlyError(err) {
  const text = (err && (err.code || err.message)) || String(err);
  if (/permission/i.test(text)) {
    return "Permission denied. Check that the newest database rules are published in Firebase.";
  }
  return text;
}

function showNotice(text, isError) {
  const el = $("qbNotice");
  el.textContent = text;
  el.classList.toggle("good", !isError);
  el.classList.remove("hidden");
}

function hideNotice() {
  $("qbNotice").classList.add("hidden");
}

function setFormMsg(text, isError) {
  const el = $("qbFormMsg");
  el.textContent = text;
  el.className = "status" + (text ? (isError ? " bad" : " good") : "");
}

// ============================================================
// THE FORM (add and edit)
// ============================================================
function clearInvalid() {
  FORM_FIELD_IDS.forEach((id) => $(id).removeAttribute("aria-invalid"));
}

function fieldElement(field) {
  if (field === "grade") return $("qbGrade");
  if (field === "topic") return $("qbTopic");
  if (field === "text") return $("qbText");
  if (field === "correct") return $("qbCorrect0");
  if (field.startsWith("choice")) return $("qbChoice" + field.slice(6));
  return null;
}

function openForm(q) {
  editingId = q ? q.id : null;
  hideNotice();
  setFormMsg("", false);
  clearInvalid();

  $("qbFormTitle").textContent = q ? "Edit question" : "Add a question";
  $("qbSave").textContent = q ? "Save changes" : "Save question";
  $("qbGrade").value = q ? String(q.grade) : lastGrade;
  $("qbTopic").value = q ? q.topic : lastTopic;
  $("qbText").value = q ? q.text : "";
  CHOICE_IDS.forEach((id, i) => { $(id).value = q ? (q.choices[i] || "") : ""; });
  RADIO_IDS.forEach((id, i) => { $(id).checked = q ? i === q.correctIndex : false; });
  $("qbExplain").value = q ? q.explanation : "";

  $("qbFormCard").classList.remove("hidden");
  $("qbFormCard").scrollIntoView({ block: "start" });
  (q ? $("qbText") : $("qbGrade")).focus();
}

function closeForm() {
  editingId = null;
  setFormMsg("", false);
  clearInvalid();
  $("qbFormCard").classList.add("hidden");
}

function readForm() {
  const checked = RADIO_IDS.findIndex((id) => $(id).checked);
  return {
    grade: $("qbGrade").value,
    topic: $("qbTopic").value,
    text: $("qbText").value,
    choices: CHOICE_IDS.map((id) => $(id).value),
    correctIndex: checked >= 0 ? checked : null,
    explanation: $("qbExplain").value
  };
}

async function saveQuestion(event) {
  event.preventDefault();
  if (saving || !uid) return;

  clearInvalid();
  setFormMsg("", false);

  // 1. Check the form. Nothing is saved unless every rule passes.
  const result = validateQuestion(readForm());
  if (!result.ok) {
    setFormMsg(result.error, true);
    const el = fieldElement(result.field);
    if (el) {
      el.setAttribute("aria-invalid", "true");
      el.focus();
    }
    return;
  }

  const data = result.data;
  data.topic = canonicalTopic(data.topic, collectTopics(questions));

  // 2. Save it.
  saving = true;
  $("qbSave").disabled = true;
  setFormMsg("Saving…", false);

  try {
    if (editingId) {
      const old = questions.find((q) => q.id === editingId);
      data.createdAt = old && old.createdAt ? old.createdAt : serverTimestamp();
      data.updatedAt = serverTimestamp();
      await set(ref(db, basePath() + "/" + editingId), data);
      closeForm();
      showNotice("Question updated.", false);
      $("qbNotice").scrollIntoView({ block: "nearest" });
    } else {
      data.createdAt = serverTimestamp();
      data.updatedAt = serverTimestamp();
      await set(push(ref(db, basePath())), data);

      // Keep grade and topic for the next question; clear the rest.
      lastGrade = String(data.grade);
      lastTopic = data.topic;
      $("qbText").value = "";
      CHOICE_IDS.forEach((id) => { $(id).value = ""; });
      RADIO_IDS.forEach((id) => { $(id).checked = false; });
      $("qbExplain").value = "";
      setFormMsg("Question saved. You can add another one.", false);
      $("qbText").focus();
    }
  } catch (err) {
    setFormMsg("Could not save the question: " + friendlyError(err), true);
  } finally {
    saving = false;
    $("qbSave").disabled = false;
  }
}

// ============================================================
// DELETE
// ============================================================
async function deleteQuestion(q) {
  try {
    await remove(ref(db, basePath() + "/" + q.id));
    confirmingId = null;
    if (editingId === q.id) closeForm();
    showNotice("Question deleted.", false);
  } catch (err) {
    showNotice("Could not delete the question: " + friendlyError(err), true);
  }
}

// ============================================================
// THE LIST, SEARCH AND FILTERS
// ============================================================
function makeOption(value, text) {
  const option = h("option", "", text);
  option.value = value;
  return option;
}

// Rebuilds the topic drop-down (filter) and the topic suggestions (form).
function refreshTopicControls() {
  const used = collectTopics(questions);

  const filter = $("qbTopicFilter");
  filter.replaceChildren(makeOption("", "All topics"), ...used.map((t) => makeOption(t, t)));
  if (filters.topic && !used.some((t) => t.toLowerCase() === filters.topic.toLowerCase())) {
    filters.topic = "";
  }
  filter.value = filters.topic;

  $("qbTopicList").replaceChildren(...allTopicOptions(questions).map((t) => makeOption(t, "")));
}

function hasFilters() {
  return Boolean(filters.search.trim() || filters.grade || filters.topic);
}

function renderList() {
  const list = $("qbList");
  list.replaceChildren();
  $("qbClear").classList.toggle("hidden", !hasFilters());

  if (!loaded) { $("qbCount").textContent = "Loading questions…"; return; }

  const shown = filterQuestions(questions, filters);
  const total = questions.length;
  $("qbCount").textContent =
    total === 0
      ? "No questions yet"
      : "Showing " + shown.length + " of " + total + " question" + (total === 1 ? "" : "s");

  if (total === 0) {
    const empty = h("div", "card empty");
    empty.append(
      h("h2", "", "No questions yet"),
      h("p", "muted", "Click “Add question” to write your first grammar question.")
    );
    list.appendChild(empty);
    return;
  }

  if (shown.length === 0) {
    const empty = h("div", "card empty");
    empty.append(
      h("h2", "", "No matching questions"),
      h("p", "muted", "Try different words, or clear the filters.")
    );
    list.appendChild(empty);
    return;
  }

  shown.forEach((q) => list.appendChild(buildCard(q)));
}

function buildCard(q) {
  const card = h("article", "qcard");

  const meta = h("div", "qmeta");
  meta.append(h("span", "tag", gradeLabel(q.grade)), h("span", "tag topic", q.topic));
  card.appendChild(meta);

  card.appendChild(h("p", "qcard-text", q.text));

  const options = h("div", "qopts");
  q.choices.forEach((choice, i) => {
    const correct = i === q.correctIndex;
    const row = h("div", "qopt" + (correct ? " correct" : ""));
    row.append(h("span", "opt-letter", LETTERS[i]), h("span", "opt-text", choice));
    if (correct) row.appendChild(h("span", "correct-mark", "✓ Correct"));
    options.appendChild(row);
  });
  card.appendChild(options);

  if (q.explanation) {
    const explain = h("p", "qexplain");
    explain.append(h("b", "", "Explanation: "), h("span", "", q.explanation));
    card.appendChild(explain);
  }

  const actions = h("div", "btn-row");
  if (confirmingId === q.id) {
    // Confirmation step before deleting
    const yes = h("button", "btn small danger-solid", "Yes, delete");
    yes.type = "button";
    yes.addEventListener("click", () => deleteQuestion(q));
    const no = h("button", "btn small ghost", "Cancel");
    no.type = "button";
    no.addEventListener("click", () => { confirmingId = null; renderList(); });
    actions.append(h("span", "confirm-text", "Delete this question? This cannot be undone."), yes, no);
  } else {
    const edit = h("button", "btn small ghost", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openForm(q));
    const del = h("button", "btn small danger", "Delete");
    del.type = "button";
    del.addEventListener("click", () => { hideNotice(); confirmingId = q.id; renderList(); });
    actions.append(edit, del);
  }
  card.appendChild(actions);

  return card;
}
