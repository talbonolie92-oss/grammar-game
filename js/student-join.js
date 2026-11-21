
/* ------------------------------------------------------------
   js/student-join.js — Phase 7
   Student:
   - PIN joining and registration
   - Synchronized progression
   - Individual progression
   - Per-student question state
   - Answer submission and feedback
   - Countdown, scores and leaderboard
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
const gamePlaySection = $("gamePlaySection");
const resultsSection = $("resultsSection");
const joinForm = $("studentJoinForm");
const joinButton = $("joinGameBtn");
const joinMessage = $("joinMessage");

let studentUid = null;
let gameId = null;
let gameData = null;
let studentState = null;
let studentName = "";
let studentSection = "";

let playerAnswers = {};
let currentQuestionIndex = null;
let selectedChoice = null;
let countdownInterval = null;

let gameListener = null;
let studentStateListener = null;
let answerListener = null;
let scoreListener = null;

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

function showMessage(message, error = false) {
  joinMessage.textContent = message;
  joinMessage.className = "status" + (error ? " bad" : " good");
}

function setPlayMessage(message) {
  $("gamePlayStatus").textContent = message;
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function showWaiting(name, section) {
  formSection.classList.add("hidden");
  waitingSection.classList.remove("hidden");
  $("waitingPin").textContent = pin;
  $("waitingStudent").textContent = `${name} — ${section}`;
}

function showGameplay() {
  loading.classList.add("hidden");
  formSection.classList.add("hidden");
  waitingSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  gamePlaySection.classList.remove("hidden");
}

function showFinalResults() {
  stopCountdown();
  gamePlaySection.classList.add("hidden");
  waitingSection.classList.add("hidden");
  formSection.classList.add("hidden");
  resultsSection.classList.remove("hidden");
  $("finalStudentName").textContent = studentName;
}

function getQuestionState() {
  return gameData?.progressionMode === "individual"
    ? studentState
    : gameData;
}

function getQuestionIndex(state) {
  return Number(state?.currentQuestionIndex);
}

function updateCountdown(state) {
  stopCountdown();

  const timerElement = $("questionTimer");

  function refresh() {
    if (state.status === "paused") {
      timerElement.textContent =
        Math.max(0, Number(state.pausedRemaining) || 0);
      return;
    }

    if (state.status !== "active") {
      timerElement.textContent = "--";
      return;
    }

    const remaining = Math.max(
      0,
      Math.ceil((Number(state.answerDeadline) - Date.now()) / 1000)
    );

    timerElement.textContent = remaining;

    if (remaining <= 0) {
      stopCountdown();
      setPlayMessage("Time is up! Wait for the answer to be revealed.");
      disableAnswerButtons();
    }
  }

  refresh();

  if (state.status === "active") {
    countdownInterval = setInterval(refresh, 250);
  }
}

function disableAnswerButtons() {
  document.querySelectorAll("#answerChoices button").forEach((button) => {
    button.disabled = true;
  });
}

function renderChoices(question, index, state) {
  const container = $("answerChoices");
  $("answerStatus").className = "status center";
  container.replaceChildren();

  const choices = Array.isArray(question.choices)
    ? question.choices
    : Object.values(question.choices || {});

  selectedChoice = null;

  const existingAnswer = playerAnswers["q" + index];

  if (existingAnswer) {
    selectedChoice = Number(existingAnswer.choiceIndex);
  }

  choices.forEach((choice, choiceIndex) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "btn block";
    button.style.display = "block";
    button.style.width = "100%";
    button.style.marginBottom = "10px";
    button.textContent =
      String.fromCharCode(65 + choiceIndex) + ". " + choice;

    button.disabled =
      Boolean(existingAnswer) ||
      state.status !== "active" ||
      state.answerRevealed === true;

    if (selectedChoice === choiceIndex) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      submitAnswer(index, choiceIndex, button);
    });

    container.appendChild(button);
  });

  if (existingAnswer) {
    $("answerStatus").textContent = "Your answer has been submitted.";
    setPlayMessage("Your answer is locked. Wait for the answer.");
  } else {
    $("answerStatus").textContent = "";
    setPlayMessage(
      state.status === "paused"
        ? "The game is paused."
        : "Choose your answer."
    );
  }

  if (state.status === "paused" || state.answerRevealed === true) {
    disableAnswerButtons();
  }
}

async function submitAnswer(questionIndex, choiceIndex, clickedButton) {
  if (!gameId || !studentUid) return;

  if (playerAnswers["q" + questionIndex]) {
    $("answerStatus").textContent =
      "You have already submitted an answer.";
    return;
  }

  clickedButton.disabled = true;

  try {
    const individual = gameData.progressionMode === "individual";

    const stateSnapshot = await get(
      ref(
        db,
        individual
          ? "gameStudentState/" + gameId + "/" + studentUid
          : "games/" + gameId
      )
    );

    const latestState = stateSnapshot.val();

    if (
      !latestState ||
      latestState.status !== "active" ||
      latestState.answerRevealed === true ||
      getQuestionIndex(latestState) !== questionIndex ||
      Date.now() > Number(latestState.answerDeadline)
    ) {
      throw new Error("The answer period has ended.");
    }

    const answer = {
      questionIndex,
      choiceIndex,
      submittedAt: Date.now()
    };

    const answerPath =
      "gameAnswers/" + gameId + "/" + studentUid + "/q" + questionIndex;

    await set(ref(db, answerPath), answer);

    playerAnswers["q" + questionIndex] = answer;
    selectedChoice = choiceIndex;

    renderChoices(latestState.currentQuestion, questionIndex, latestState);

    $("answerStatus").textContent = "Answer submitted successfully!";
    setPlayMessage("Your answer is locked. Wait for the answer.");

  } catch (error) {
    console.error("Answer submission error:", error);
    clickedButton.disabled = false;
    $("answerStatus").textContent =
      error.message || "Could not submit your answer.";
  }
}

function renderQuestion(state) {
  if (!state?.currentQuestion) return;

  const index = getQuestionIndex(state);

  if (!Number.isInteger(index) || index < 0) return;

  if (currentQuestionIndex !== index) {
    currentQuestionIndex = index;
    selectedChoice = null;
  }

  showGameplay();

  const total = Number(gameData.questionCount) || 0;

  $("questionProgress").textContent =
    "Question " + (index + 1) + " of " + total;

  $("liveQuestionText").textContent =
    state.currentQuestion.text || "Question unavailable.";

  renderChoices(state.currentQuestion, index, state);
  updateCountdown(state);

  if (state.status === "paused") {
    setPlayMessage("Your teacher has paused the game.");
  }

  if (state.answerRevealed === true) {
    showAnswerFeedback(state);
  } else {
    $("answerStatus").textContent =
      playerAnswers["q" + index]
        ? "Your answer has been submitted."
        : "";
  }
}

function showAnswerFeedback(state) {
  const index = getQuestionIndex(state);
  const answer = playerAnswers["q" + index];
  const correctIndex = Number(state.revealedCorrectIndex);

  const choices = Array.isArray(state.currentQuestion.choices)
    ? state.currentQuestion.choices
    : Object.values(state.currentQuestion.choices || {});

  const correctChoice = choices[correctIndex] || "Unavailable";

  if (!answer) {
    $("answerStatus").textContent =
      "You did not submit an answer. Correct answer: " + correctChoice;
  } else if (Number(answer.choiceIndex) === correctIndex) {
    $("answerStatus").textContent = "Correct! Well done!";
  } else {
    $("answerStatus").textContent =
      "Not quite. The correct answer is: " + correctChoice;
  }

  $("answerStatus").className =
    "status center " +
    (answer && Number(answer.choiceIndex) === correctIndex
      ? "good"
      : "bad");

  disableAnswerButtons();

  $("gamePlayStatus").textContent =
    state.revealedExplanation || "Wait for your teacher to continue.";

  stopCountdown();
}

function renderScore(scores) {
  const ownScore = scores && scores[studentUid];
  if (!ownScore) return;

  $("studentScore").textContent = Number(ownScore.score) || 0;
  $("finalStudentScore").textContent = Number(ownScore.score) || 0;
  $("finalStudentRank").textContent =
    "Your rank: #" + (ownScore.rank || "-");
}

function renderLeaderboard(scores) {
  const container = $("studentLeaderboard");
  container.replaceChildren();

  const entries = Object.entries(scores || {})
    .map(([uid, score]) => ({ uid, ...score }))
    .sort((a, b) =>
      (Number(a.rank) || 999) - (Number(b.rank) || 999)
    );

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No scores are available yet.";
    container.appendChild(empty);
    return;
  }

  entries.forEach((student) => {
    const row = document.createElement("div");
    row.className = "list-row";

    const name = document.createElement("strong");
    name.textContent =
      "#" + (student.rank || "-") + " " + student.name;

    const score = document.createElement("span");
    score.className = "muted";
    score.textContent = Number(student.score) + " points";

    row.append(name, score);
    container.appendChild(row);
  });
}

function listenToAnswers() {
  if (answerListener) answerListener();

  answerListener = onValue(
    ref(db, "gameAnswers/" + gameId + "/" + studentUid),
    (snapshot) => {
      playerAnswers = snapshot.val() || {};

      const state = getQuestionState();
      if (state?.currentQuestion) renderQuestion(state);
    },
    (error) => console.error("Answer listener error:", error)
  );
}

function listenToScores() {
  if (scoreListener) scoreListener();

  scoreListener = onValue(
    ref(db, "gameScores/" + gameId),
    (snapshot) => {
      const scores = snapshot.val() || {};
      renderScore(scores);
      renderLeaderboard(scores);
    },
    (error) => console.error("Score listener error:", error)
  );
}

function listenToStudentState() {
  if (studentStateListener) studentStateListener();

  studentStateListener = onValue(
    ref(db, "gameStudentState/" + gameId + "/" + studentUid),
    (snapshot) => {
      studentState = snapshot.val();

      if (gameData?.progressionMode === "individual") {
        if (gameData.status === "finished") {
          showFinalResults();
        } else if (
          studentState?.status === "finished" ||
          studentState?.status === "completed"
        ) {
          stopCountdown();
          gamePlaySection.classList.add("hidden");
          $("gamePlayStatus").textContent =
            "You have completed all the questions. Wait for the final results.";
        } else if (
          studentState?.currentQuestion &&
          ["active", "paused"].includes(studentState.status)
        ) {
          renderQuestion(studentState);
        }
      }
    },
    (error) => {
      console.error("Student state listener error:", error);
      showError("Unable to load your individual game progress. Please refresh.");
    }
  );
}

function listenToGame() {
  if (gameListener) gameListener();

  gameListener = onValue(
    ref(db, "games/" + gameId),
    (snapshot) => {
      if (!snapshot.exists()) {
        showError("This game is no longer available.");
        stopCountdown();
        return;
      }

      gameData = snapshot.val();

      if (gameData.status === "waiting") {
        stopCountdown();

        gamePlaySection.classList.add("hidden");
        resultsSection.classList.add("hidden");
        waitingSection.classList.remove("hidden");

        $("waitingGameStatus").textContent =
          "Waiting for your teacher to start the game...";

      } else if (gameData.status === "active" ||
                 gameData.status === "paused") {

        if (gameData.progressionMode === "individual") {
          if (studentState?.currentQuestion) {
            renderQuestion(studentState);
          }
        } else {
          renderQuestion(gameData);
        }

      } else if (gameData.status === "finished") {
        showFinalResults();

      } else if (gameData.status === "cancelled") {
        stopCountdown();
        showError("Your teacher has closed this game.");
      }
    },
    (error) => {
      console.error("Game listener error:", error);
      showError("Unable to receive game updates. Please refresh.");
    }
  );
}

async function connectToGame() {
  try {
    if (configMissing || !auth || !db) {
      throw new Error("Firebase is not configured correctly.");
    }

    if (!/^\d{6}$/.test(pin)) {
      throw new Error(
        "Invalid Game PIN. Please use the six-digit PIN given by your teacher."
      );
    }

    const credential = await signInAnonymously(auth);
    studentUid = credential.user.uid;

    const pinSnapshot = await get(ref(db, "gamePins/" + pin));

    if (!pinSnapshot.exists()) {
      throw new Error("Game PIN not found. Please check the PIN with your teacher.");
    }

    const pinData = pinSnapshot.val();

    if (!pinData || typeof pinData.gameId !== "string") {
      throw new Error("This Game PIN is invalid.");
    }

    gameId = pinData.gameId;

    const gameSnapshot = await get(ref(db, "games/" + gameId));

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
    formSection.classList.remove("hidden");

  } catch (error) {
    loading.classList.add("hidden");
    showError(error.message || "Unable to connect to the game.");
  }
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  hideError();
  showMessage("");

  if (!studentUid || !gameId || !gameData) {
    showError("Game connection is missing. Please reload the page.");
    return;
  }

  studentName = $("studentName").value.trim();
  studentSection = $("studentSection").value.trim();

  if (!studentName || !studentSection) {
    showMessage("Please enter your name and class/section.", true);
    return;
  }

  if (studentName.length > 40 || studentSection.length > 30) {
    showMessage("Please check the length of your name and section.", true);
    return;
  }

  joinButton.disabled = true;
  joinButton.textContent = "Joining...";

  try {
    const latestGame = await get(ref(db, "games/" + gameId));

    if (!latestGame.exists() || latestGame.val().status !== "waiting") {
      throw new Error("The game is no longer accepting students.");
    }

    await set(ref(db, "gamePlayers/" + gameId + "/" + studentUid), {
      name: studentName,
      section: studentSection,
      joinedAt: Date.now()
    });

    showWaiting(studentName, studentSection);

    listenToAnswers();
    listenToScores();
    listenToGame();
    listenToStudentState();

  } catch (error) {
    showError(error.message || "Unable to join the game.");

    joinButton.disabled = false;
    joinButton.textContent = "Join game";
  }
});

connectToGame();
