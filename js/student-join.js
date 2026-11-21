
/* ------------------------------------------------------------
   js/student-join.js - Phase 4
   - Anonymous student sign-in
   - Game PIN lookup
   - Game information display
   - Student name and section registration
   - Live waiting screen
   ------------------------------------------------------------ */

import { auth, db, configMissing } from "./firebase-config.js";

import {
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  ref,
  get,
  set,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);

const loading = $("joinLoading");
const errorBox = $("joinError");
const formSection = $("joinFormSection");
const waitingSection = $("waitingSection");

const joinForm = $("studentJoinForm");
const joinButton = $("joinGameBtn");
const joinMessage = $("joinMessage");

let studentUid = null;
let gameId = null;
let gameData = null;
let gameStatusListener = null;

const params = new URLSearchParams(window.location.search);
const pin = (params.get("pin") || "").trim();

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function showForm() {
  loading.classList.add("hidden");
  formSection.classList.remove("hidden");
}

function showWaiting(name, section) {
  formSection.classList.add("hidden");
  waitingSection.classList.remove("hidden");

  $("waitingPin").textContent = pin;
  $("waitingStudent").textContent = `${name} — ${section}`;
}

function setMessage(message) {
  joinMessage.textContent = message;
}

async function connectToGame() {
  try {
    if (configMissing || !auth || !db) {
      throw new Error("Firebase is not configured correctly.");
    }

    if (!/^\d{6}$/.test(pin)) {
      throw new Error("Invalid Game PIN. Please use the six-digit PIN given by your teacher.");
    }

    // Sign in anonymously as a student.
    const credential = await signInAnonymously(auth);
    studentUid = credential.user.uid;

    // Look up the game using the six-digit PIN.
    const pinSnapshot = await get(ref(db, `gamePins/${pin}`));

    if (!pinSnapshot.exists()) {
      throw new Error("Game PIN not found. Please check the PIN with your teacher.");
    }

    const pinData = pinSnapshot.val();

    if (!pinData || typeof pinData.gameId !== "string") {
      throw new Error("This Game PIN is invalid.");
    }

    gameId = pinData.gameId;

    // Load the public game information.
    const gameSnapshot = await get(ref(db, `games/${gameId}`));

    if (!gameSnapshot.exists()) {
      throw new Error("This game is no longer available.");
    }

    gameData = gameSnapshot.val();

    if (gameData.status !== "waiting") {
      throw new Error("This game is no longer accepting students.");
    }

    $("gameDetails").textContent =
      `Grade ${gameData.grade} • ${gameData.topic} • ${gameData.questionCount} questions`;

    loading.classList.add("hidden");
    showForm();

  } catch (error) {
    loading.classList.add("hidden");
    showError(error.message || "Unable to connect to the game.");
  }
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  hideError();
  setMessage("");

  if (!studentUid || !gameId || !gameData) {
    showError("Game connection is missing. Please reload the page.");
    return;
  }

  const name = $("studentName").value.trim();
  const section = $("studentSection").value.trim();

  if (!name || !section) {
    setMessage("Please enter your name and class/section.");
    return;
  }

  if (name.length > 40 || section.length > 30) {
    setMessage("Please check the length of your name and section.");
    return;
  }

  joinButton.disabled = true;
  joinButton.textContent = "Joining...";

  try {
    // Check that the game is still waiting.
    const latestGame = await get(ref(db, `games/${gameId}`));

    if (!latestGame.exists() || latestGame.val().status !== "waiting") {
      throw new Error("The game is no longer accepting students.");
    }

    // Each student can only write to their own UID entry.
    await set(ref(db, `gamePlayers/${gameId}/${studentUid}`), {
      name,
      section,
      joinedAt: Date.now()
    });

    showWaiting(name, section);

    // Listen for the teacher changing the game status.
    const statusRef = ref(db, `games/${gameId}/status`);

    gameStatusListener = onValue(statusRef, (snapshot) => {
      const status = snapshot.val();
      const statusText = $("waitingGameStatus");

      if (status === "waiting") {
        statusText.textContent =
          "Waiting for your teacher to start the game...";
      } else if (status === "active") {
        statusText.textContent =
          "Your teacher has started the game. Please wait for the quiz screen.";
      } else if (status === "finished") {
        statusText.textContent =
          "This game has finished.";
      } else if (status === "cancelled" || status === null) {
        statusText.textContent =
          "This game has been closed by your teacher.";
      }
    });

  } catch (error) {
    showError(error.message || "Unable to join the game.");
    joinButton.disabled = false;
    joinButton.textContent = "Join game";
  }
});

// Start the student joining process.
connectToGame();
