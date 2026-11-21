
/* ------------------------------------------------------------
   js/game-host.js — Phase 4
   Teacher: Create Game and manage the waiting lobby.
   Private questions are stored separately from public game data.
   ------------------------------------------------------------ */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  get,
  set,
  onValue,
  push,
  remove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);

let teacherUid = null;
let questions = [];
let currentGameId = null;
let stopPlayersListener = null;
let gameBusy = false;

const section = $("sec-create");

if (section) {
  section.innerHTML = `
    <header class="page-head">
      <h1>Create Game</h1>
      <p class="muted">Choose your questions and prepare a live classroom game.</p>
    </header>

    <div class="card">
      <h2>Game settings</h2>
      <div id="gameLoadMessage" class="notice hidden"></div>

      <form id="gameForm">
        <div class="form-row">
          <label>Grade
            <select id="gameGrade" required>
              <option value="">Select grade</option>
              <option value="10">Grade 10</option>
              <option value="11">Grade 11</option>
              <option value="12">Grade 12</option>
            </select>
          </label>

          <label>Grammar topic
            <select id="gameTopic" required disabled>
              <option value="">Select a grade first</option>
            </select>
          </label>
        </div>

        <div class="form-row">
          <label>Number of questions
            <input id="gameQuestionCount" type="number"
              min="1" max="50" value="10" required>
          </label>

          <label>Time per question (seconds)
            <input id="gameTimer" type="number"
              min="5" max="120" value="20" required>
          </label>
        </div>

        <label>Game mode
          <select id="gameMode">
            <option value="classic">Classic Quiz</option>
            <option value="speed">Speed Battle</option>
          </select>
        </label>

        <p id="gameQuestionInfo" class="muted">
          Select a grade and topic to see available questions.
        </p>

        <button id="createGameBtn" class="btn" type="submit">
          Create Game
        </button>
        <p id="gameFormMessage" class="status" role="status"></p>
      </form>
    </div>

    <div id="activeGameCard" class="card hidden">
      <h2>Your game is ready</h2>
      <p class="muted">Share these details with your students.</p>

      <div class="game-pin-display">
        <div class="muted">GAME PIN</div>
        <div id="gamePin" class="game-pin">------</div>
      </div>

      <label>Joining link
        <input id="gameJoinLink" type="text" readonly>
      </label>

      <div class="actions">
        <button id="copyGameLink" class="btn ghost" type="button">
          Copy joining link
        </button>
        <button id="copyGamePin" class="btn ghost" type="button">
          Copy PIN
        </button>
      </div>

      <div class="qr-area">
        <img id="gameQr" alt="QR code for joining this game">
        <p class="muted">Students can scan this QR code to join.</p>
      </div>

      <hr>

      <h2>Waiting lobby</h2>
      <p class="muted">Students who join will appear here.</p>
      <p><strong id="playerCount">0 students joined</strong></p>
      <div id="playerList" class="list"></div>
    </div>
  `;

  const message = (text, error = false) => {
    const el = $("gameFormMessage");
    el.textContent = text;
    el.className = "status" + (error ? " bad" : " good");
  };

  function showLoadMessage(text, error = false) {
    const el = $("gameLoadMessage");
    el.textContent = text;
    el.classList.toggle("hidden", !text);
    el.classList.toggle("good", !error);
  }

  function availableQuestions() {
    const grade = Number($("gameGrade").value);
    const topic = $("gameTopic").value;

    return questions.filter((q) =>
      q.grade === grade && q.topic === topic
    );
  }

  function updateQuestionInfo() {
    const grade = $("gameGrade").value;
    const topic = $("gameTopic").value;
    const matches = availableQuestions();

    $("gameQuestionInfo").textContent =
      grade && topic
        ? matches.length + " question(s) available for this selection."
        : "Select a grade and topic to see available questions.";

    // Allow the teacher to enter up to 50.
    // createGame() checks whether enough questions actually exist.
    $("gameQuestionCount").max = 50;
  }

  function updateTopics() {
    const grade = Number($("gameGrade").value);
    const topicSelect = $("gameTopic");

    topicSelect.replaceChildren();

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select a topic";
    topicSelect.appendChild(first);

    const topics = [...new Set(
      questions
        .filter((q) => q.grade === grade)
        .map((q) => q.topic)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    topics.forEach((topic) => {
      const option = document.createElement("option");
      option.value = topic;
      option.textContent = topic;
      topicSelect.appendChild(option);
    });

    topicSelect.disabled = topics.length === 0;

    if (topics.length === 0 && grade) {
      first.textContent = "No topics available for this grade";
    }

    updateQuestionInfo();
  }

  function shuffle(items) {
    const result = [...items];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  function makePin() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return String(100000 + (values[0] % 900000));
  }

  function renderPlayers(players) {
    const list = $("playerList");
    list.replaceChildren();

    const entries = Object.entries(players || {});

    $("playerCount").textContent =
      entries.length +
      (entries.length === 1 ? " student joined" : " students joined");

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Waiting for students to join...";
      list.appendChild(empty);
      return;
    }

    entries.forEach(([uid, player], index) => {
      const row = document.createElement("div");
      row.className = "list-row";

      const name = document.createElement("strong");
      name.textContent = (index + 1) + ". " + (player.name || "Student");

      const details = document.createElement("span");
      details.className = "muted";
      details.textContent = player.section || "No section";

      row.append(name, details);
      list.appendChild(row);
    });
  }

  function listenToPlayers(gameId) {
    if (stopPlayersListener) stopPlayersListener();

    stopPlayersListener = onValue(
      ref(db, "gamePlayers/" + gameId),
      (snapshot) => renderPlayers(snapshot.val() || {}),
      (error) => {
        console.error("Lobby listener error:", error);
        showLoadMessage(
          "Could not load the student lobby. Check Firebase rules.",
          true
        );
      }
    );
  }

  async function reservePin(gameId, pin) {
    const result = await runTransaction(
      ref(db, "gamePins/" + pin),
      (current) => {
        if (current !== null) return;

        return {
          gameId,
          ownerUid: teacherUid,
          status: "waiting",
          createdAt: Date.now()
        };
      },
      { applyLocally: false }
    );

    return result.committed;
  }

  async function createGame(event) {
    event.preventDefault();

    if (gameBusy || !teacherUid) return;

    message("");

    const grade = Number($("gameGrade").value);
    const topic = $("gameTopic").value;
    const count = Number($("gameQuestionCount").value);
    const timer = Number($("gameTimer").value);
    const mode = $("gameMode").value;

    const matches = availableQuestions();

    if (!grade || !topic) {
      message("Please select a grade and topic.", true);
      return;
    }

    if (!Number.isInteger(count) || count < 1 || count > 50) {
      message("Choose between 1 and 50 questions.", true);
      return;
    }

    if (!Number.isInteger(timer) || timer < 5 || timer > 120) {
      message("Timer must be between 5 and 120 seconds.", true);
      return;
    }

    if (count > matches.length) {
      message(
        "Only " + matches.length +
        " questions are available for this topic. Add more questions or choose a smaller number.",
        true
      );
      return;
    }

    if (!["classic", "speed"].includes(mode)) {
      message("Please select a valid game mode.", true);
      return;
    }

    gameBusy = true;
    $("createGameBtn").disabled = true;
    $("createGameBtn").textContent = "Creating game...";

    let reservedPin = null;
    let gameId = null;
    let currentStage = "Preparing game";

    try {
      const selected = shuffle(matches).slice(0, count);

      gameId = push(ref(db, "games")).key;

      if (!gameId) {
        throw new Error("Could not create a game ID.");
      }

      const privateQuestions = selected.map((q) => ({
        grade: q.grade,
        topic: q.topic,
        text: q.text,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation || ""
      }));

      const publicGame = {
        ownerUid: teacherUid,
        grade,
        topic,
        mode,
        timer,
        questionCount: count,
        status: "waiting",
        createdAt: Date.now()
      };

      // Stage 1: Reserve a unique six-digit PIN.
      currentStage = "Reserving game PIN";

      for (let attempt = 0; attempt < 15; attempt++) {
        const pin = makePin();

        if (await reservePin(gameId, pin)) {
          reservedPin = pin;
          break;
        }
      }

      if (!reservedPin) {
        throw new Error("Could not reserve a unique PIN. Please try again.");
      }

      // Stage 2: Save public game information.
      currentStage = "Saving public game";

      await set(ref(db, "games/" + gameId), publicGame);

      // Stage 3: Save questions and correct answers privately.
      currentStage = "Saving private questions";

      await set(ref(db, "gamePrivate/" + gameId), {
        ownerUid: teacherUid,
        questions: privateQuestions
      });

      currentGameId = gameId;

      const joinUrl = new URL(
        "student.html?pin=" + reservedPin,
        window.location.href
      ).href;

      $("gamePin").textContent = reservedPin;
      $("gameJoinLink").value = joinUrl;

      $("gameQr").src =
        "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" +
        encodeURIComponent(joinUrl);

      $("activeGameCard").classList.remove("hidden");
      $("activeGameCard").scrollIntoView({ behavior: "smooth" });

      // Stage 4: Open the live student lobby.
      currentStage = "Opening student lobby";

      listenToPlayers(gameId);

      message("Game created successfully.");

    } catch (error) {
      console.error("Create game error:", error);

      if (reservedPin) {
        try {
          await remove(ref(db, "gamePins/" + reservedPin));
        } catch (cleanupError) {
          console.error("PIN cleanup error:", cleanupError);
        }
      }

      if (gameId) {
        try {
          await remove(ref(db, "games/" + gameId));
          await remove(ref(db, "gamePrivate/" + gameId));
        } catch (cleanupError) {
          console.error("Game cleanup error:", cleanupError);
        }
      }

      message(
        "Could not create the game during " + currentStage +
        ": " + (error.message || error),
        true
      );

    } finally {
      gameBusy = false;
      $("createGameBtn").disabled = false;
      $("createGameBtn").textContent = "Create Game";
    }
  }

  $("gameGrade").addEventListener("change", updateTopics);
  $("gameTopic").addEventListener("change", updateQuestionInfo);
  $("gameForm").addEventListener("submit", createGame);

  $("copyGameLink").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("gameJoinLink").value);
      message("Joining link copied.");
    } catch {
      message(
        "Copy failed. Select and copy the joining link manually.",
        true
      );
    }
  });

  $("copyGamePin").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("gamePin").textContent);
      message("Game PIN copied.");
    } catch {
      message("Copy failed. You can select the PIN manually.", true);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user || user.isAnonymous) return;

    try {
      const allowed = await get(ref(db, "allowedTeachers/" + user.uid));

      if (allowed.val() !== true) return;

      teacherUid = user.uid;

      const settingsSnapshot = await get(
        ref(db, "teachers/" + teacherUid + "/settings")
      );

      const settings = settingsSnapshot.val() || {};

      $("gameTimer").value = settings.defaultTimer || 20;
      $("gameMode").value = settings.defaultMode || "classic";

      const questionSnapshot = await get(
        ref(db, "teachers/" + teacherUid + "/questions")
      );

      const raw = questionSnapshot.val() || {};

      questions = Object.entries(raw).map(([id, q]) => ({
        id,
        grade: Number(q.grade),
        topic: String(q.topic || ""),
        text: String(q.text || ""),
        choices: Object.values(q.choices || {}).map(String),
        correctIndex: Number(q.correctIndex),
        explanation: String(q.explanation || "")
      }));

      showLoadMessage(
        questions.length
          ? questions.length + " saved questions loaded."
          : "Your Question Bank is empty. Add questions before creating a game."
      );

      updateTopics();

    } catch (error) {
      console.error("Game setup error:", error);

      showLoadMessage(
        "Could not load your questions or settings. Check Firebase permissions.",
        true
      );
    }
  });
}
