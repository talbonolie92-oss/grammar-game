
/* ------------------------------------------------------------
   js/game-host.js — Phase 7 FIXED
   - Synchronized and Individual progression
   - Randomized question order per student
   - Automatic progression after answer or timeout
   - Manual reveal and next-question controls
   - Pause, resume, and end game
   - Scoring, leaderboard, and completed game history
   ------------------------------------------------------------ */

import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  ref, get, set, update, onValue, push, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);

let teacherUid = null;
let questions = [];
let currentGameId = null;
let currentGameQuestions = [];
let currentQuestionIndex = -1;
let progressionMode = "synchronized";

let stopPlayersListener = null;
let stopScoresListener = null;
let stopAnswersListener = null;
let stopStudentStatesListener = null;

let gameBusy = false;
let individualTimer = null;
let individualAdvanceTimers = {};
let processingAnswers = new Set();
let processedTimeouts = new Set();

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
            <input id="gameQuestionCount" type="number" min="1" max="50" value="10" required>
          </label>
          <label>Time per question (seconds)
            <input id="gameTimer" type="number" min="5" max="120" value="20" required>
          </label>
        </div>

        <label>Game mode
          <select id="gameMode">
            <option value="classic">Classic Quiz</option>
            <option value="speed">Speed Battle</option>
          </select>
        </label>

        <label>Question progression
          <select id="gameProgression">
            <option value="synchronized">Synchronized — students move together</option>
            <option value="individual">Individual — students progress independently</option>
          </select>
        </label>

        <p class="muted">
          Synchronized: everyone answers together.
          Individual: each student receives a randomized question order.
        </p>

        <p id="gameQuestionInfo" class="muted">Select a grade and topic.</p>
        <button id="createGameBtn" class="btn" type="submit">Create Game</button>
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
        <button id="copyGameLink" class="btn ghost" type="button">Copy joining link</button>
        <button id="copyGamePin" class="btn ghost" type="button">Copy PIN</button>
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
      <hr>

      <div id="gameControlPanel" class="hidden">
        <h2>Game controls</h2>
        <p id="gameControlMessage" class="status" role="status">Waiting for you to start the game.</p>

        <div class="actions">
          <button id="startGameBtn" class="btn" type="button">Start Game</button>
          <button id="pauseGameBtn" class="btn ghost hidden" type="button">Pause Game</button>
          <button id="resumeGameBtn" class="btn hidden" type="button">Resume Game</button>
          <button id="revealAnswerBtn" class="btn ghost hidden" type="button">Reveal Answer</button>
          <button id="nextQuestionBtn" class="btn hidden" type="button">Next Question</button>
          <button id="endGameBtn" class="btn ghost hidden" type="button">End Game</button>
        </div>

        <div id="teacherQuestionPreview" class="card hidden">
          <p class="muted" id="teacherQuestionNumber"></p>
          <h3 id="teacherQuestionText"></h3>
          <div id="teacherQuestionChoices"></div>
          <p id="teacherCorrectAnswer" class="good hidden"></p>
          <p id="teacherExplanation" class="muted"></p>
        </div>

        <div class="card">
          <h3>Live leaderboard</h3>
          <div id="teacherLeaderboard" class="list">
            <p class="muted">Scores will appear after the first answer.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const message = (text, error = false) => {
    const el = $("gameFormMessage");
    el.textContent = text;
    el.className = "status" + (error ? " bad" : " good");
  };

  function controlMessage(text, error = false) {
    const el = $("gameControlMessage");
    el.textContent = text;
    el.className = "status" + (error ? " bad" : " good");
  }

  function showLoadMessage(text, error = false) {
    const el = $("gameLoadMessage");
    el.textContent = text;
    el.classList.toggle("hidden", !text);
    el.classList.toggle("good", !error);
  }

  function availableQuestions() {
    const grade = Number($("gameGrade").value);
    const topic = $("gameTopic").value;
    return questions.filter(q => q.grade === grade && q.topic === topic);
  }

  function updateQuestionInfo() {
    const grade = $("gameGrade").value;
    const topic = $("gameTopic").value;
    const count = availableQuestions().length;

    $("gameQuestionInfo").textContent = grade && topic
      ? count + " question(s) available for this selection."
      : "Select a grade and topic to see available questions.";
  }

  function updateTopics() {
    const grade = Number($("gameGrade").value);
    const select = $("gameTopic");
    select.replaceChildren();

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Select a topic";
    select.appendChild(first);

    const topics = [...new Set(
      questions.filter(q => q.grade === grade).map(q => q.topic).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    topics.forEach(topic => {
      const option = document.createElement("option");
      option.value = topic;
      option.textContent = topic;
      select.appendChild(option);
    });

    select.disabled = !topics.length;
    if (!topics.length && grade) first.textContent = "No topics available";
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
      entries.length + (entries.length === 1 ? " student joined" : " students joined");

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
      name.textContent = `${index + 1}. ${player.name || "Student"}`;

      const details = document.createElement("span");
      details.className = "muted";
      details.textContent = player.section || "No section";

      row.append(name, details);
      list.appendChild(row);
    });
  }

  function renderLeaderboard(scores) {
    const list = $("teacherLeaderboard");
    list.replaceChildren();

    const entries = Object.entries(scores || {})
      .map(([uid, score]) => ({ uid, ...score }))
      .sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999));

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Scores will appear after the first answer.";
      list.appendChild(empty);
      return;
    }

    entries.forEach(student => {
      const row = document.createElement("div");
      row.className = "list-row";

      const name = document.createElement("strong");
      name.textContent = `#${student.rank || "-"} ${student.name || "Student"}`;

      const details = document.createElement("span");
      details.className = "muted";
      details.textContent =
        `${Number(student.score) || 0} points • ${Number(student.correct) || 0} correct`;

      row.append(name, details);
      list.appendChild(row);
    });
  }

  function listenToPlayers(gameId) {
    if (stopPlayersListener) stopPlayersListener();
    stopPlayersListener = onValue(
      ref(db, "gamePlayers/" + gameId),
      snap => renderPlayers(snap.val() || {}),
      error => {
        console.error(error);
        showLoadMessage("Could not load the student lobby. Check Firebase rules.", true);
      }
    );
  }

  function listenToScores(gameId) {
    if (stopScoresListener) stopScoresListener();
    stopScoresListener = onValue(
      ref(db, "gameScores/" + gameId),
      snap => renderLeaderboard(snap.val() || {}),
      error => {
        console.error(error);
        controlMessage("Could not load the leaderboard.", true);
      }
    );
  }

  function listenToStudentStates(gameId) {
    if (stopStudentStatesListener) stopStudentStatesListener();
    stopStudentStatesListener = onValue(
      ref(db, "gameStudentState/" + gameId),
      snap => {
        if (progressionMode !== "individual") return;
        const states = Object.values(snap.val() || {});
        const completed = states.filter(s => s && s.finished).length;
        const active = states.filter(s => s && !s.finished).length;
        if (states.length) {
          controlMessage(`Individual progress: ${completed} finished • ${active} still playing.`);
        }
      },
      error => console.error("Student state listener:", error)
    );
  }

  function listenToAnswers(gameId) {
    if (stopAnswersListener) stopAnswersListener();
    stopAnswersListener = onValue(
      ref(db, "gameAnswers/" + gameId),
      snap => {
        if (progressionMode !== "individual") return;
        const allAnswers = snap.val() || {};

        for (const [uid, studentAnswers] of Object.entries(allAnswers)) {
          for (const [key, answer] of Object.entries(studentAnswers || {})) {
            if (!answer) continue;
            const answerId = uid + "_" + key;
            if (!processingAnswers.has(answerId)) {
              processIndividualAnswer(uid, key, answer, answerId);
            }
          }
        }
      },
      error => {
        console.error(error);
        controlMessage("Could not monitor individual answers.", true);
      }
    );
  }

  async function reservePin(gameId, pin) {
    const result = await runTransaction(
      ref(db, "gamePins/" + pin),
      current => {
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

  function showControls() {
    $("gameControlPanel").classList.remove("hidden");
    $("startGameBtn").classList.remove("hidden");
  }

  function hideButton(id) {
    $(id).classList.add("hidden");
  }

  function showButton(id) {
    $(id).classList.remove("hidden");
  }

  function renderQuestionPreview(question, index) {
    $("teacherQuestionPreview").classList.remove("hidden");
    $("teacherQuestionNumber").textContent =
      `Question ${index + 1} of ${currentGameQuestions.length}`;
    $("teacherQuestionText").textContent = question.text;

    const choices = $("teacherQuestionChoices");
    choices.replaceChildren();

    question.choices.forEach((choice, i) => {
      const row = document.createElement("p");
      row.textContent = `${String.fromCharCode(65 + i)}. ${choice}`;
      choices.appendChild(row);
    });

    $("teacherCorrectAnswer").classList.add("hidden");
    $("teacherExplanation").textContent = "";
  }

  function updateControlButtons(status, revealed) {
    [
      "startGameBtn", "pauseGameBtn", "resumeGameBtn",
      "revealAnswerBtn", "nextQuestionBtn", "endGameBtn"
    ].forEach(hideButton);

    if (status === "waiting") {
      showButton("startGameBtn");
    } else if (status === "active") {
      showButton("pauseGameBtn");
      showButton("endGameBtn");
      if (revealed) {
        hideButton("pauseGameBtn");
        showButton("nextQuestionBtn");
      } else {
        showButton("revealAnswerBtn");
      }
    } else if (status === "paused") {
      showButton("resumeGameBtn");
      showButton("endGameBtn");
      if (revealed) showButton("nextQuestionBtn");
      else showButton("revealAnswerBtn");
    }
  }

  function stopIndividualTimer() {
    if (individualTimer) clearInterval(individualTimer);
    individualTimer = null;
  }

  function clearAdvanceTimer(uid) {
    if (individualAdvanceTimers[uid]) {
      clearTimeout(individualAdvanceTimers[uid]);
      delete individualAdvanceTimers[uid];
    }
  }

  function getStudentQuestion(uid, position, orders) {
    const order = orders?.[uid];
    if (!Array.isArray(order)) return null;
    const questionIndex = order[position];
    if (!Number.isInteger(questionIndex)) return null;
    return currentGameQuestions[questionIndex] || null;
  }

  async function publishIndividualQuestion(uid, position, order) {
    const question = getStudentQuestion(uid, position, { [uid]: order });
    const stateRef = ref(db, `gameStudentState/${currentGameId}/${uid}`);

    if (!question) {
      await set(stateRef, {
        currentQuestionIndex: Math.max(0, position),
        currentQuestion: {
          text: "You have completed the game.",
          choices: ["Completed", "Completed", "Completed", "Completed"]
        },
        questionStartedAt: Date.now(),
        answerDeadline: Date.now(),
        answerRevealed: true,
        finished: true,
        status: "completed"
      });
      return;
    }

    const now = Date.now();
    await set(stateRef, {
      currentQuestionIndex: position,
      currentQuestion: {
        text: question.text,
        choices: question.choices
      },
      questionStartedAt: now,
      answerDeadline: now + Number($("gameTimer").value) * 1000,
      answerRevealed: false,
      revealedCorrectIndex: null,
      revealedExplanation: "",
      pausedRemaining: null,
      finished: false,
      status: "active"
    });
  }

  async function startIndividualGame() {
    const playersSnap = await get(ref(db, "gamePlayers/" + currentGameId));
    const players = playersSnap.val() || {};
    const entries = Object.entries(players);

    if (!entries.length) throw new Error("No students have joined the lobby yet.");

    const orders = {};
    for (const [uid] of entries) {
      orders[uid] = shuffle(currentGameQuestions.map((q, i) => i));
    }

    await update(ref(db, "gamePrivate/" + currentGameId), {
      studentOrders: orders
    });

    for (const [uid] of entries) {
      await publishIndividualQuestion(uid, 0, orders[uid]);
    }

    await update(ref(db, "games/" + currentGameId), {
      status: "active",
      currentQuestionIndex: 0,
      answerRevealed: false
    });

    listenToAnswers(currentGameId);
    listenToStudentStates(currentGameId);
    startIndividualTimer();

    renderQuestionPreview(currentGameQuestions[0], 0);
    updateControlButtons("active", false);
    controlMessage("Individual mode started. Students have separate randomized question orders.");
  }

  async function showQuestion(index) {
    const question = currentGameQuestions[index];
    if (!question) throw new Error("The requested question could not be found.");

    const now = Date.now();
    await update(ref(db, "games/" + currentGameId), {
      status: "active",
      currentQuestionIndex: index,
      currentQuestion: { text: question.text, choices: question.choices },
      questionStartedAt: now,
      answerDeadline: now + Number($("gameTimer").value) * 1000,
      answerRevealed: false,
      revealedCorrectIndex: null,
      revealedExplanation: null,
      pausedRemaining: null
    });

    currentQuestionIndex = index;
    renderQuestionPreview(question, index);
    updateControlButtons("active", false);
    controlMessage(`Question ${index + 1} is now live.`);
  }

  async function startGame() {
    if (!currentGameId) return;

    try {
      $("startGameBtn").disabled = true;
      controlMessage("Preparing the game...");

      const snap = await get(ref(db, "gamePrivate/" + currentGameId));
      if (!snap.exists()) throw new Error("Private questions could not be found.");

      const data = snap.val();
      if (data.ownerUid !== teacherUid) throw new Error("You are not the owner of this game.");

      currentGameQuestions = Object.values(data.questions || {});
      if (!currentGameQuestions.length) throw new Error("This game has no questions.");

      if (progressionMode === "individual") {
        await startIndividualGame();
      } else {
        await showQuestion(0);
      }
    } catch (error) {
      console.error(error);
      controlMessage(error.message || "Could not start the game.", true);
    } finally {
      $("startGameBtn").disabled = false;
    }
  }

  async function refreshRanks() {
    const snap = await get(ref(db, "gameScores/" + currentGameId));
    const scores = snap.val() || {};
    const ranked = Object.entries(scores).sort(
      (a, b) => (Number(b[1].score) || 0) - (Number(a[1].score) || 0)
    );

    const updates = {};
    ranked.forEach(([uid], index) => {
      updates[uid + "/rank"] = index + 1;
    });

    if (Object.keys(updates).length) {
      await update(ref(db, "gameScores/" + currentGameId), updates);
    }
  }

  async function updateIndividualScores(uid, answer, question, deadline) {
    const [playerSnap, scoreSnap] = await Promise.all([
      get(ref(db, `gamePlayers/${currentGameId}/${uid}`)),
      get(ref(db, `gameScores/${currentGameId}/${uid}`))
    ]);

    const player = playerSnap.val();
    if (!player) return;

    const previous = scoreSnap.val() || {};
    let points = 0;
    let correct = 0;
    let answered = 0;

    if (answer) {
      answered = 1;
      const submittedAt = Number(answer.submittedAt) || 0;
      const onTime = submittedAt > 0 && submittedAt <= deadline;

      if (onTime && Number(answer.choiceIndex) === Number(question.correctIndex)) {
        correct = 1;
        points = 100;

        if ($("gameMode").value === "speed") {
          const seconds = Math.max(0, Math.floor((deadline - submittedAt) / 1000));
          points += Math.min(100, seconds * 5);
        }
      }
    }

    await set(ref(db, `gameScores/${currentGameId}/${uid}`), {
      name: player.name,
      section: player.section,
      score: (Number(previous.score) || 0) + points,
      correct: (Number(previous.correct) || 0) + correct,
      answered: (Number(previous.answered) || 0) + answered
    });

    await refreshRanks();
  }

  async function revealIndividualStudent(uid, state, answer) {
    const privateSnap = await get(ref(db, "gamePrivate/" + currentGameId));
    const privateData = privateSnap.val() || {};
    const order = privateData.studentOrders?.[uid];
    const position = Number(state.currentQuestionIndex);
    const question = getStudentQuestion(uid, position, { [uid]: order });

    if (!question) return;

    const deadline = Number(state.answerDeadline) || 0;
    await updateIndividualScores(uid, answer, question, deadline);

    await update(ref(db, `gameStudentState/${currentGameId}/${uid}`), {
      answerRevealed: true,
      revealedCorrectIndex: Number(question.correctIndex),
      revealedExplanation: question.explanation || ""
    });
  }

  async function processIndividualAnswer(uid, key, answer, answerId) {
    if (processingAnswers.has(answerId)) return;
    processingAnswers.add(answerId);

    try {
      const [stateSnap, gameSnap] = await Promise.all([
        get(ref(db, `gameStudentState/${currentGameId}/${uid}`)),
        get(ref(db, "games/" + currentGameId))
      ]);

      const state = stateSnap.val();
      const game = gameSnap.val();

      if (!state || !game || game.status !== "active" || state.finished) return;
      if (state.answerRevealed === true) return;

      const position = Number(state.currentQuestionIndex);
      if (key !== "q" + position) return;
      if (Number(answer.questionIndex) !== position) return;

      const privateSnap = await get(ref(db, "gamePrivate/" + currentGameId));
      const privateData = privateSnap.val() || {};
      const order = privateData.studentOrders?.[uid];
      const question = getStudentQuestion(uid, position, { [uid]: order });

      if (!question) return;

      const deadline = Number(state.answerDeadline) || 0;
      if (!answer.submittedAt || Number(answer.submittedAt) > deadline) {
        // Late answers are ignored for points, but timeout progression handles them.
        return;
      }

      await revealIndividualStudent(uid, state, answer);
      controlMessage("A student submitted an answer. Individual score updated.");

      clearAdvanceTimer(uid);
      individualAdvanceTimers[uid] = setTimeout(() => {
        advanceIndividualStudent(uid).catch(error => console.error(error));
      }, 3000);

    } catch (error) {
      console.error("Process individual answer:", error);
      controlMessage("Could not process an individual answer.", true);
    }
  }

  async function advanceIndividualStudent(uid) {
    clearAdvanceTimer(uid);

    const [stateSnap, privateSnap, gameSnap] = await Promise.all([
      get(ref(db, `gameStudentState/${currentGameId}/${uid}`)),
      get(ref(db, "gamePrivate/" + currentGameId)),
      get(ref(db, "games/" + currentGameId))
    ]);

    const state = stateSnap.val();
    const privateData = privateSnap.val() || {};
    const game = gameSnap.val();

    if (!state || !game || game.status !== "active" || state.finished) return;
    if (state.answerRevealed !== true) return;

    const order = privateData.studentOrders?.[uid];
    if (!Array.isArray(order)) return;

    await publishIndividualQuestion(
      uid,
      Number(state.currentQuestionIndex) + 1,
      order
    );
  }

  async function timeoutIndividualStudent(uid, state, order) {
    const position = Number(state.currentQuestionIndex);
    const timeoutId = uid + "_q" + position;

    if (processedTimeouts.has(timeoutId)) return;

    try {
      const [answerSnap, latestStateSnap, gameSnap] = await Promise.all([
        get(ref(db, `gameAnswers/${currentGameId}/${uid}/q${position}`)),
        get(ref(db, `gameStudentState/${currentGameId}/${uid}`)),
        get(ref(db, "games/" + currentGameId))
      ]);

      const latestState = latestStateSnap.val();
      const game = gameSnap.val();

      if (!latestState || !game || game.status !== "active") return;
      if (latestState.finished || latestState.answerRevealed) return;
      if (Number(latestState.currentQuestionIndex) !== position) return;

      const deadline = Number(latestState.answerDeadline) || 0;
      if (Date.now() < deadline) return;

      processedTimeouts.add(timeoutId);

      const question = getStudentQuestion(uid, position, { [uid]: order });
      if (!question) return;

      const answer = answerSnap.val();
      // Late answers count as attempted but earn no points.
      await updateIndividualScores(uid, answer, question, deadline);

      await update(ref(db, `gameStudentState/${currentGameId}/${uid}`), {
        answerRevealed: true,
        revealedCorrectIndex: Number(question.correctIndex),
        revealedExplanation: question.explanation || ""
      });

      clearAdvanceTimer(uid);
      individualAdvanceTimers[uid] = setTimeout(() => {
        advanceIndividualStudent(uid).catch(error => console.error(error));
      }, 3000);

    } catch (error) {
      processedTimeouts.delete(timeoutId);
      console.error("Individual timeout:", error);
    }
  }

  function startIndividualTimer() {
    stopIndividualTimer();

    individualTimer = setInterval(async () => {
      try {
        const [statesSnap, privateSnap, gameSnap] = await Promise.all([
          get(ref(db, "gameStudentState/" + currentGameId)),
          get(ref(db, "gamePrivate/" + currentGameId)),
          get(ref(db, "games/" + currentGameId))
        ]);

        const game = gameSnap.val();
        if (!game || game.status !== "active") return;

        const states = statesSnap.val() || {};
        const orders = privateSnap.val()?.studentOrders || {};

        for (const [uid, state] of Object.entries(states)) {
          if (!state || state.finished || state.answerRevealed) continue;
          if (Date.now() >= Number(state.answerDeadline)) {
            await timeoutIndividualStudent(uid, state, orders[uid]);
          }
        }
      } catch (error) {
        console.error("Individual timer:", error);
      }
    }, 1000);
  }

  async function revealIndividualAnswers() {
    const [statesSnap, answersSnap] = await Promise.all([
      get(ref(db, "gameStudentState/" + currentGameId)),
      get(ref(db, "gameAnswers/" + currentGameId))
    ]);

    const states = statesSnap.val() || {};
    const answers = answersSnap.val() || {};

    for (const [uid, state] of Object.entries(states)) {
      if (!state || state.finished || state.answerRevealed) continue;

      const position = Number(state.currentQuestionIndex);
      const answer = answers[uid]?.["q" + position] || null;

      await revealIndividualStudent(uid, state, answer);

      clearAdvanceTimer(uid);
      individualAdvanceTimers[uid] = setTimeout(() => {
        advanceIndividualStudent(uid).catch(error => console.error(error));
      }, 3000);
    }

    controlMessage("Answers revealed for students who are still answering.");
  }

  async function pauseGame() {
    try {
      const gameSnap = await get(ref(db, "games/" + currentGameId));
      const game = gameSnap.val();
      if (!game || game.status !== "active") return;

      if (progressionMode === "individual") {
        stopIndividualTimer();

        const statesSnap = await get(ref(db, "gameStudentState/" + currentGameId));
        const states = statesSnap.val() || {};
        const updates = {};

        for (const [uid, state] of Object.entries(states)) {
          if (!state || state.finished || state.answerRevealed) continue;
          updates[uid + "/pausedRemaining"] = Math.max(
            0,
            Math.ceil((Number(state.answerDeadline) - Date.now()) / 1000)
          );
          updates[uid + "/status"] = "paused";
        }

        if (Object.keys(updates).length) {
          await update(ref(db, "gameStudentState/" + currentGameId), updates);
        }

        await update(ref(db, "games/" + currentGameId), { status: "paused" });
      } else {
        const remaining = Math.max(
          0,
          Math.ceil((Number(game.answerDeadline) - Date.now()) / 1000)
        );
        await update(ref(db, "games/" + currentGameId), {
          status: "paused",
          pausedRemaining: remaining
        });
      }

      updateControlButtons("paused", false);
      controlMessage("Game paused.");
    } catch (error) {
      console.error(error);
      controlMessage(error.message || "Could not pause the game.", true);
    }
  }

  async function resumeGame() {
    try {
      const gameSnap = await get(ref(db, "games/" + currentGameId));
      const game = gameSnap.val();
      if (!game || game.status !== "paused") return;

      if (progressionMode === "individual") {
        const statesSnap = await get(ref(db, "gameStudentState/" + currentGameId));
        const states = statesSnap.val() || {};
        const updates = {};
        const now = Date.now();

        for (const [uid, state] of Object.entries(states)) {
          if (!state || state.finished || state.answerRevealed) continue;
          const remaining = Math.max(0, Number(state.pausedRemaining) || 0);

          updates[uid + "/questionStartedAt"] = now;
          updates[uid + "/answerDeadline"] = now + remaining * 1000;
          updates[uid + "/pausedRemaining"] = null;
          updates[uid + "/status"] = "active";
        }

        if (Object.keys(updates).length) {
          await update(ref(db, "gameStudentState/" + currentGameId), updates);
        }

        await update(ref(db, "games/" + currentGameId), { status: "active" });
        startIndividualTimer();
      } else {
        if (game.answerRevealed === true) {
          updateControlButtons("paused", true);
          return;
        }

        const now = Date.now();
        const remaining = Math.max(0, Number(game.pausedRemaining) || 0);

        await update(ref(db, "games/" + currentGameId), {
          status: "active",
          questionStartedAt: now,
          answerDeadline: now + remaining * 1000,
          pausedRemaining: null
        });
      }

      updateControlButtons("active", false);
      controlMessage("Game resumed.");
    } catch (error) {
      console.error(error);
      controlMessage(error.message || "Could not resume the game.", true);
    }
  }

  async function calculateScores(questionIndex, correctIndex) {
    const [playersSnap, answersSnap, scoresSnap, gameSnap] = await Promise.all([
      get(ref(db, "gamePlayers/" + currentGameId)),
      get(ref(db, "gameAnswers/" + currentGameId)),
      get(ref(db, "gameScores/" + currentGameId)),
      get(ref(db, "games/" + currentGameId))
    ]);

    const players = playersSnap.val() || {};
    const answers = answersSnap.val() || {};
    const previousScores = scoresSnap.val() || {};
    const game = gameSnap.val() || {};
    const deadline = Number(game.answerDeadline) || 0;
    const updatedScores = {};

    for (const [uid, player] of Object.entries(players)) {
      const previous = previousScores[uid] || {};
      const answer = answers[uid]?.["q" + questionIndex] ||
        answers[uid]?.[String(questionIndex)];

      let points = 0;
      let correct = 0;
      let answered = 0;

      if (answer) {
        answered = 1;
        const submittedAt = Number(answer.submittedAt) || 0;
        const onTime = submittedAt > 0 && deadline > 0 && submittedAt <= deadline;

        if (onTime && Number(answer.choiceIndex) === correctIndex) {
          correct = 1;
          points = 100;

          if (game.mode === "speed") {
            const seconds = Math.max(0, Math.floor((deadline - submittedAt) / 1000));
            points += Math.min(100, seconds * 5);
          }
        }
      }

      updatedScores[uid] = {
        name: player.name,
        section: player.section,
        score: (Number(previous.score) || 0) + points,
        correct: (Number(previous.correct) || 0) + correct,
        answered: (Number(previous.answered) || 0) + answered
      };
    }

    const ranked = Object.entries(updatedScores).sort((a, b) => b[1].score - a[1].score);
    ranked.forEach(([uid, score], index) => score.rank = index + 1);

    await set(ref(db, "gameScores/" + currentGameId), updatedScores);
  }

  async function revealAnswer() {
    try {
      if (progressionMode === "individual") {
        await revealIndividualAnswers();
        updateControlButtons("active", true);
        return;
      }

      const snap = await get(ref(db, "games/" + currentGameId));
      const game = snap.val();
      if (!game || game.answerRevealed === true) return;

      const question = currentGameQuestions[currentQuestionIndex];
      if (!question) throw new Error("Current question is missing.");

      controlMessage("Checking answers and calculating scores...");
      await calculateScores(currentQuestionIndex, Number(question.correctIndex));

      await update(ref(db, "games/" + currentGameId), {
        answerRevealed: true,
        revealedCorrectIndex: Number(question.correctIndex),
        revealedExplanation: question.explanation || ""
      });

      $("teacherCorrectAnswer").textContent =
        "Correct answer: " + question.choices[question.correctIndex];
      $("teacherCorrectAnswer").classList.remove("hidden");
      $("teacherExplanation").textContent = question.explanation || "";

      updateControlButtons(game.status, true);
      controlMessage("Answer revealed. Scores and leaderboard updated.");
    } catch (error) {
      console.error(error);
      controlMessage(error.message || "Could not reveal the answer.", true);
    }
  }

  async function nextIndividualQuestion() {
    const statesSnap = await get(ref(db, "gameStudentState/" + currentGameId));
    const states = statesSnap.val() || {};

    for (const [uid, state] of Object.entries(states)) {
      if (!state || state.finished) continue;

      clearAdvanceTimer(uid);

      if (state.answerRevealed !== true) {
        const privateSnap = await get(ref(db, "gamePrivate/" + currentGameId));
        const privateData = privateSnap.val() || {};
        const order = privateData.studentOrders?.[uid];
        const position = Number(state.currentQuestionIndex);
        const question = getStudentQuestion(uid, position, { [uid]: order });

        if (question) {
          const answerSnap = await get(
            ref(db, `gameAnswers/${currentGameId}/${uid}/q${position}`)
          );
          await updateIndividualScores(
            uid, answerSnap.val(), question, Number(state.answerDeadline)
          );
          await update(ref(db, `gameStudentState/${currentGameId}/${uid}`), {
            answerRevealed: true,
            revealedCorrectIndex: Number(question.correctIndex),
            revealedExplanation: question.explanation || ""
          });
        }
      }

      await advanceIndividualStudent(uid);
    }

    controlMessage("Students have been moved to their next individual question.");
  }

  async function nextQuestion() {
    try {
      if (progressionMode === "individual") {
        await nextIndividualQuestion();
        updateControlButtons("active", false);
        return;
      }

      if (currentQuestionIndex + 1 >= currentGameQuestions.length) {
        await endGame();
        return;
      }

      await showQuestion(currentQuestionIndex + 1);
    } catch (error) {
      console.error(error);
      controlMessage(error.message || "Could not load the next question.", true);
    }
  }

  async function saveGameHistory() {
    if (!teacherUid || !currentGameId) {
      throw new Error("Missing teacher or game information.");
    }

    const historyRef = ref(db, `gameHistory/${teacherUid}/${currentGameId}`);
    const existing = await get(historyRef);
    if (existing.exists()) return false;

    const [gameSnap, playersSnap, scoresSnap] = await Promise.all([
      get(ref(db, "games/" + currentGameId)),
      get(ref(db, "gamePlayers/" + currentGameId)),
      get(ref(db, "gameScores/" + currentGameId))
    ]);

    const game = gameSnap.val();
    if (!game) throw new Error("The game record could not be found.");
    if (game.ownerUid !== teacherUid) throw new Error("You are not the owner of this game.");

    const players = playersSnap.val() || {};
    const scores = scoresSnap.val() || {};
    const historyPlayers = {};

    for (const [uid, player] of Object.entries(players)) {
      const score = scores[uid] || {};
      historyPlayers[uid] = {
        name: String(player.name || "Student"),
        section: String(player.section || ""),
        score: Math.max(0, Number(score.score) || 0),
        correct: Math.max(0, Number(score.correct) || 0),
        answered: Math.max(0, Number(score.answered) || 0),
        rank: 1
      };
    }

    const ranked = Object.entries(historyPlayers).sort(
      (a, b) => b[1].score - a[1].score
    );
    ranked.forEach(([uid, player], index) => player.rank = index + 1);

    const record = {
      ownerUid: teacherUid,
      grade: Number(game.grade),
      topic: String(game.topic || ""),
      mode: String(game.mode || "classic"),
      timer: Number(game.timer),
      questionCount: Number(game.questionCount),
      createdAt: Number(game.createdAt) || Date.now(),
      finishedAt: Date.now(),
      status: "finished",
      playerCount: Object.keys(players).length
    };

    if (Object.keys(historyPlayers).length) record.players = historyPlayers;
    await set(historyRef, record);
    return true;
  }

  async function endGame() {
    if (!currentGameId || gameBusy) return;
    gameBusy = true;

    try {
      const gameRef = ref(db, "games/" + currentGameId);
      const snap = await get(gameRef);
      const game = snap.val();

      if (!game) throw new Error("The game could not be found.");
      if (game.ownerUid !== teacherUid) throw new Error("You are not the owner of this game.");

      if (game.status !== "finished") {
        const confirmed = window.confirm(
          "Are you sure you want to end this game? The final results will be saved."
        );
        if (!confirmed) return;
        await update(gameRef, { status: "finished" });
      }

      stopIndividualTimer();
      Object.keys(individualAdvanceTimers).forEach(clearAdvanceTimer);

      if (progressionMode === "individual") {
        const statesSnap = await get(ref(db, "gameStudentState/" + currentGameId));
        const states = statesSnap.val() || {};
        const updates = {};

        for (const [uid, state] of Object.entries(states)) {
          if (!state || state.finished) continue;
          updates[uid + "/finished"] = true;
          updates[uid + "/status"] = "finished";
        }

        if (Object.keys(updates).length) {
          await update(ref(db, "gameStudentState/" + currentGameId), updates);
        }
      }

      controlMessage("Saving completed game and final results...");
      const saved = await saveGameHistory();

      [
        "startGameBtn", "pauseGameBtn", "resumeGameBtn",
        "revealAnswerBtn", "nextQuestionBtn", "endGameBtn"
      ].forEach(hideButton);

      if (stopPlayersListener) stopPlayersListener();
      if (stopScoresListener) stopScoresListener();
      if (stopAnswersListener) stopAnswersListener();
      if (stopStudentStatesListener) stopStudentStatesListener();

      stopPlayersListener = null;
      stopScoresListener = null;
      stopAnswersListener = null;
      stopStudentStatesListener = null;

      controlMessage(saved
        ? "Game finished successfully. Final results and participants have been saved to Game History."
        : "This game was already saved to Game History. No duplicate record was created."
      );
    } catch (error) {
      console.error(error);
      controlMessage("Saving game history failed: " + (error.message || error), true);
    } finally {
      gameBusy = false;
    }
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
    const selectedProgression = $("gameProgression").value;
    const matches = availableQuestions();

    if (!grade || !topic) return message("Please select a grade and topic.", true);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return message("Choose between 1 and 50 questions.", true);
    }
    if (!Number.isInteger(timer) || timer < 5 || timer > 120) {
      return message("Timer must be between 5 and 120 seconds.", true);
    }
    if (count > matches.length) {
      return message(`Only ${matches.length} questions are available.`, true);
    }
    if (!["classic", "speed"].includes(mode)) {
      return message("Please select a valid game mode.", true);
    }
    if (!["synchronized", "individual"].includes(selectedProgression)) {
      return message("Please select a valid progression mode.", true);
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
      if (!gameId) throw new Error("Could not create a game ID.");

      const privateQuestions = selected.map(q => ({
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
        progressionMode: selectedProgression,
        timer,
        questionCount: count,
        status: "waiting",
        createdAt: Date.now()
      };

      currentStage = "Reserving game PIN";

      for (let attempt = 0; attempt < 15; attempt++) {
        const pin = makePin();
        if (await reservePin(gameId, pin)) {
          reservedPin = pin;
          break;
        }
      }

      if (!reservedPin) throw new Error("Could not reserve a unique PIN.");

      currentStage = "Saving public game";
      await set(ref(db, "games/" + gameId), publicGame);

      currentStage = "Saving private questions";
      await set(ref(db, "gamePrivate/" + gameId), {
        ownerUid: teacherUid,
        questions: privateQuestions
      });

      currentGameId = gameId;
      currentGameQuestions = [];
      currentQuestionIndex = -1;
      progressionMode = selectedProgression;

      processingAnswers.clear();
      processedTimeouts.clear();

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

      showControls();
      $("teacherQuestionPreview").classList.add("hidden");

      currentStage = "Opening student lobby";
      listenToPlayers(gameId);
      listenToScores(gameId);

      message("Game created successfully.");
    } catch (error) {
      console.error(error);

      if (reservedPin) {
        try {
          await remove(ref(db, "gamePins/" + reservedPin));
        } catch (cleanupError) {
          console.error(cleanupError);
        }
      }

      if (gameId) {
        try {
          await remove(ref(db, "games/" + gameId));
          await remove(ref(db, "gamePrivate/" + gameId));
        } catch (cleanupError) {
          console.error(cleanupError);
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
      message("Copy failed. Select and copy the joining link manually.", true);
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

  $("startGameBtn").addEventListener("click", startGame);
  $("pauseGameBtn").addEventListener("click", pauseGame);
  $("resumeGameBtn").addEventListener("click", resumeGame);
  $("revealAnswerBtn").addEventListener("click", revealAnswer);
  $("nextQuestionBtn").addEventListener("click", nextQuestion);
  $("endGameBtn").addEventListener("click", endGame);

  onAuthStateChanged(auth, async user => {
    if (!user || user.isAnonymous) return;

    try {
      const allowed = await get(ref(db, "allowedTeachers/" + user.uid));
      if (allowed.val() !== true) return;

      teacherUid = user.uid;

      const settingsSnap = await get(
        ref(db, "teachers/" + teacherUid + "/settings")
      );
      const settings = settingsSnap.val() || {};

      $("gameTimer").value = settings.defaultTimer || 20;
      $("gameMode").value = settings.defaultMode || "classic";

      const questionsSnap = await get(
        ref(db, "teachers/" + teacherUid + "/questions")
      );

      const raw = questionsSnap.val() || {};

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
      console.error(error);
      showLoadMessage(
        "Could not load your questions or settings. Check Firebase permissions.",
        true
      );
    }
  });
}
