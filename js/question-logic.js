// ------------------------------------------------------------
// js/question-logic.js  (Phase 3)
// The "rules" of the Question Bank, kept apart from the screen code
// so they are easy to read and easy to test:
//   - what makes a question valid
//   - how searching and filtering work
//   - how grammar topics are collected
// This file does not talk to Firebase and does not touch the page.
// ------------------------------------------------------------
import { cleanText } from "./common.js";

export const GRADES = [10, 11, 12];
export const LETTERS = ["A", "B", "C", "D"];

// Suggestions shown while typing a topic. You can still type any other topic.
export const SUGGESTED_TOPICS = [
  "Parts of Speech",
  "Nouns",
  "Pronouns",
  "Verbs",
  "Tenses",
  "Subject-Verb Agreement",
  "Adjectives and Adverbs",
  "Prepositions",
  "Conjunctions",
  "Modals",
  "Conditionals",
  "Active and Passive Voice",
  "Direct and Indirect Speech",
  "Relative Clauses",
  "Gerunds and Infinitives",
  "Articles",
  "Sentence Structure"
];

export function gradeLabel(grade) {
  return "Grade " + grade;
}

function fail(field, error) {
  return { ok: false, field, error };
}

// ------------------------------------------------------------
// Validation
// raw = { grade, topic, text, choices: [4 texts], correctIndex, explanation }
// Returns { ok: true, data } or { ok: false, field, error }.
// "field" says which input to point at: "grade", "topic", "text",
// "choice0".."choice3" or "correct".
// ------------------------------------------------------------
export function validateQuestion(raw) {
  const grade = Number(raw.grade);
  if (!GRADES.includes(grade)) return fail("grade", "Please select a grade.");

  const topic = cleanText(raw.topic, 60);
  if (!topic) return fail("topic", "Please enter the grammar topic.");

  const text = cleanText(raw.text, 500);
  if (!text) return fail("text", "Please type the question.");

  const given = Array.isArray(raw.choices) ? raw.choices : [];
  if (given.length !== 4) return fail("choice0", "Exactly four answer choices are required.");
  const choices = given.map((c) => cleanText(c, 200));

  for (let i = 0; i < 4; i++) {
    if (!choices[i]) return fail("choice" + i, "Please fill in answer choice " + LETTERS[i] + ".");
  }

  const lower = choices.map((c) => c.toLowerCase());
  for (let i = 0; i < 4; i++) {
    if (lower.indexOf(lower[i]) !== i) {
      return fail("choice" + i, "Each answer choice must be different. Choice " + LETTERS[i] + " repeats an earlier choice.");
    }
  }

  const correctIndex = raw.correctIndex;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return fail("correct", "Please select the correct answer.");
  }

  const explanation = cleanText(raw.explanation, 500);

  const data = { grade, topic, text, choices, correctIndex };
  if (explanation) data.explanation = explanation; // optional: only saved when typed
  return { ok: true, data };
}

// ------------------------------------------------------------
// Topics
// "tenses", "Tenses" and "TENSES" are treated as the same topic,
// so the topic filter does not split into near-duplicates.
// ------------------------------------------------------------
function sortText(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

// Topics used by the saved questions, without duplicates, A to Z.
export function collectTopics(questions) {
  const seen = new Map();
  questions.forEach((q) => {
    const key = q.topic.toLowerCase();
    if (q.topic && !seen.has(key)) seen.set(key, q.topic);
  });
  return Array.from(seen.values()).sort(sortText);
}

// Suggestions plus the teacher's own topics, without duplicates, A to Z.
export function allTopicOptions(questions) {
  const seen = new Map();
  collectTopics(questions).concat(SUGGESTED_TOPICS).forEach((t) => {
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  });
  return Array.from(seen.values()).sort(sortText);
}

// If the teacher types a topic that already exists (in any capital letters),
// reuse the existing spelling.
export function canonicalTopic(typed, usedTopics) {
  const key = typed.toLowerCase();
  const pools = [usedTopics, SUGGESTED_TOPICS];
  for (const pool of pools) {
    for (const t of pool) {
      if (t.toLowerCase() === key) return t;
    }
  }
  return typed;
}

// ------------------------------------------------------------
// Sorting and filtering
// ------------------------------------------------------------
export function sortNewestFirst(questions) {
  return questions.slice().sort(
    (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || sortText(a.text, b.text)
  );
}

// filters = { search: "text", grade: "" or "10"/"11"/"12", topic: "" or a topic }
// Every word in the search box must appear somewhere in the question,
// its choices, its topic or its explanation.
export function filterQuestions(questions, filters) {
  const words = String(filters.search || "").toLowerCase().split(/\s+/).filter(Boolean);
  const grade = filters.grade ? Number(filters.grade) : null;
  const topic = filters.topic ? filters.topic.toLowerCase() : "";

  return questions.filter((q) => {
    if (grade !== null && q.grade !== grade) return false;
    if (topic && q.topic.toLowerCase() !== topic) return false;
    if (words.length === 0) return true;
    const haystack = [q.topic, q.text, q.choices.join(" "), q.explanation || ""]
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
