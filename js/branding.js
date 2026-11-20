// ------------------------------------------------------------
// js/branding.js
// Shows your school logo when the file assets/school-logo.png exists.
// If the file is missing, the neutral "Logo" placeholder stays visible.
// Nothing else in the app depends on this file.
// ------------------------------------------------------------
(function () {
  document.querySelectorAll(".school-logo").forEach(function (slot) {
    var img = slot.querySelector("img");
    var placeholder = slot.querySelector(".logo-placeholder");
    if (!img || !placeholder) return;

    function showLogo() {
      img.hidden = false;
      placeholder.hidden = true;
    }

    // The image starts hidden. If it loads, swap it in for the placeholder.
    img.addEventListener("load", showLogo);
    // Handles the case where the browser already has the image ready.
    if (img.complete && img.naturalWidth > 0) showLogo();
  });
})();
