// ------------------------------------------------------------
// js/common.js  -  small helpers shared by the pages.
// ------------------------------------------------------------

// h("div", "my-class", "some text") builds an element.
// The text is inserted as plain text, so nobody can sneak HTML into the page.
export function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Shows one big screen (an element with class="screen") and hides the others.
export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => {
    s.classList.toggle("hidden", s.id !== id);
  });
}

// Cleans text typed by a person: removes odd characters and extra spaces,
// and cuts it to a maximum length.
export function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
