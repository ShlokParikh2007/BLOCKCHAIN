const socket = io();

let currentPlayer = null;
let blockCount = 0;
let hasVoted = false;
let roundActive = false; // Track round state for resetting
let difficulty = 0;
const joinScreen = document.getElementById("joinScreen");
const gameScreen = document.getElementById("gameScreen");
const teamsDiv   = document.getElementById("teams");

// ── TRANSACTION ──
socket.on("transactionData", tx => {
  document.getElementById("transactionText").innerText =
    `${tx.sender} → ${tx.receiver}  |  ${tx.amount}`;
});
socket.on("transactionData", tx => {
  document.getElementById("transactionText").innerText =
    `${tx.sender} → ${tx.receiver}  |  ${tx.amount}`;
});

// ── GET INITIAL DIFFICULTY ──
socket.on("updateDifficulty", diff => {
  document.querySelector(".diff-value").innerText = diff;
});

// ── JOIN ──
function joinGame() {
  const name = document.getElementById("nameInput").value.trim();
  const team = document.getElementById("teamSelect").value;

  if (!name) { alert("Enter your name"); return; }

  currentPlayer = { name, team };
  socket.emit("joinGame", { name, team });
}

socket.on("joinSuccess", () => {
  joinScreen.style.display = "none";
  gameScreen.style.display = "flex";
});

socket.on("joinError", alert);

// ── PLAYERS LIST ──
socket.on("updatePlayers", players => {
  teamsDiv.innerHTML = "";

  const grouped = {};
  players.forEach(p => {
    if (!grouped[p.team]) grouped[p.team] = [];
    grouped[p.team].push(p.name);
  });

  for (const team in grouped) {
    const div = document.createElement("div");
    div.innerHTML = `
      <strong>${team}</strong>
      <ul>${grouped[team].map(n => `<li>${n}</li>`).join("")}</ul>
    `;
    teamsDiv.appendChild(div);
  }
});

// ── NEW SUBMISSION — show voting UI ──
socket.on("newSubmission", submission => {
  if (!currentPlayer) return;

  hasVoted = false;
  const isOwnTeam = submission.team === currentPlayer.team;

  const verifyEl = document.getElementById("verificationStatus");

  if (isOwnTeam) {
    verifyEl.innerHTML = `
      <div class="vote-waiting">
        <span class="vote-waiting-icon">⏳</span>
        Your block is being verified by other players…
      </div>
      <div id="voteProgress"></div>
    `;
  } else {
    verifyEl.innerHTML = `
      <div class="vote-submission-info">
        <span class="vote-team">${submission.team}</span> submitted a block
        <div class="vote-detail">Nonce: <span class="mono">${submission.nonce}</span></div>
        <div class="vote-detail">Hash: <span class="mono hash-small">${submission.hash}</span></div>
      </div>
      <div id="voteProgress"></div>
      <div class="vote-buttons" id="voteButtons">
        <button class="btn-vote yes" onclick="castVote('yes')">✔ Approve</button>
        <button class="btn-vote no"  onclick="castVote('no')">✘ Reject</button>
      </div>
    `;
  }
});

// ── CAST VOTE ──
function castVote(vote) {
  if (hasVoted) return;
  hasVoted = true;
  socket.emit("castVote", { vote });

  // Disable buttons after voting
  const btns = document.getElementById("voteButtons");
  if (btns) {
    btns.innerHTML = `<div class="vote-cast-msg">
      ${vote === "yes" ? "✔ You approved this block" : "✘ You rejected this block"}
    </div>`;
  }
}

// ── LIVE VOTE UPDATE ──
socket.on("voteUpdate", data => {
  const progressEl = document.getElementById("voteProgress");
  if (!progressEl) return;

  const {
    yesCount, noCount, totalEligible,
    votedCount, yesPercent, allVoted
  } = data;

  const noPercent = totalEligible > 0
    ? Math.round((noCount / totalEligible) * 100)
    : 0;

  progressEl.innerHTML = `
    <div class="vote-progress-wrap">
      <div class="vote-progress-header">
        <span class="vote-progress-label">Verification Progress</span>
        <span class="vote-progress-count">${votedCount} / ${totalEligible} voted</span>
      </div>

      <div class="vote-bar-track">
        <div class="vote-bar-yes" style="width:${yesPercent}%"></div>
        <div class="vote-bar-no"  style="width:${noPercent}%"></div>
      </div>

      <div class="vote-stats">
        <span class="vote-stat yes">✔ ${yesCount} Approved (${yesPercent}%)</span>
        <span class="vote-stat no">✘ ${noCount} Rejected (${noPercent}%)</span>
      </div>

      <div class="vote-threshold">
        Needs &gt;50% to approve
        ${yesPercent > 50
          ? '<span class="threshold-met">● Threshold met</span>'
          : '<span class="threshold-unmet">● Not yet</span>'
        }
      </div>
    </div>
  `;
});

// ── VERIFICATION RESULT ──
socket.on("verificationResult", data => {
  const verifyEl = document.getElementById("verificationStatus");

  if (data.approved) {
    verifyEl.innerHTML = `
      <div class="result-approved">
        <div class="result-icon">✔</div>
        <div class="result-title">Block Approved</div>
        <div class="result-detail">
          ${data.yesCount} of ${data.totalEligible} players approved
          (${data.yesPercent}%)
        </div>
        <div class="result-team">+ 100 pts → ${data.team}</div>
      </div>
    `;
    document.getElementById("submitStatus").innerText = "Block verified and added to chain ✔";
  } else {
    verifyEl.innerHTML = `
      <div class="result-rejected">
        <div class="result-icon">✘</div>
        <div class="result-title">Block Rejected</div>
        <div class="result-detail">
          Only ${data.yesCount} of ${data.totalEligible} approved
          (${data.yesPercent}%) — needed &gt;50%
        </div>
      </div>
    `;
    // Re-enable submit for the submitting team
    if (currentPlayer && currentPlayer.team === data.team) {
      document.getElementById("nonceInput").disabled = false;
      document.getElementById("hashInput").disabled = false;
      document.getElementById("submitBtn").disabled = false;
      document.getElementById("submitStatus").innerText = "Block was rejected. Try again.";
    }
  }

  // Reset after 6 seconds
  setTimeout(() => {
    const el = document.getElementById("verificationStatus");
    if (el) el.innerHTML = `<p>Waiting for submissions…</p>`;
  }, 6000);
});

// ── BLOCK CREATED ──
socket.on("blockCreated", block => {
  blockCount++;

  const txText = `${block.transaction.sender} → ${block.transaction.receiver} | ${block.transaction.amount}`;

  document.getElementById("blockTx").innerText    = txText;
  document.getElementById("blockTeam").innerText  = block.team;
  document.getElementById("blockNonce").innerText = block.nonce;
  document.getElementById("blockHash").innerText  = block.hash;
  document.getElementById("blockStatus").innerText = "Verified ✔";
  document.getElementById("blockStatus").className = "tag-verified";

  const historyDiv = document.getElementById("blockHistory");
  const blockCard  = document.createElement("div");
  blockCard.className = "block-card";
  blockCard.innerHTML = `
    <strong>Block #${blockCount}</strong>
    <p><b>Team:</b> ${block.team}</p>
    <p><b>Nonce:</b> ${block.nonce}</p>
    <p><b>Hash:</b> ${block.hash}</p>
  `;
  historyDiv.prepend(blockCard);

  // Remove empty state if present
  const empty = historyDiv.querySelector(".empty-state");
  if (empty) empty.remove();
});

// ── SUBMIT RESULT ──
function submitResult() {
  const nonce = document.getElementById("nonceInput").value.trim();
  const hash  = document.getElementById("hashInput").value.trim();

  if (!nonce || !hash) { alert("Please enter both nonce and hash"); return; }

  socket.emit("submitResult", { nonce, hash });

  document.getElementById("submitStatus").innerText = "Submitted. Waiting for votes…";
  document.getElementById("nonceInput").disabled = true;
  document.getElementById("hashInput").disabled  = true;
  document.getElementById("submitBtn").disabled  = true;
}

// ── ROUND STATUS ──
socket.on("roundStatus", data => {
  const timerEl = document.getElementById("roundTimer");
  const submitBtn = document.getElementById("submitBtn");
  const nonceInput = document.getElementById("nonceInput");
  const hashInput = document.getElementById("hashInput");

  if (data.active) {
    // DETECT NEW ROUND: Transition from inactive → active
    if (!roundActive) {
      // Reset submission state for new round
      hasVoted = false;
      nonceInput.disabled = false;
      nonceInput.value = "";
      hashInput.disabled = false;
      hashInput.value = "";
      submitBtn.disabled = false;
      document.getElementById("submitStatus").innerText = "";
      document.getElementById("verificationStatus").innerHTML = `<p>Waiting for submissions…</p>`;
    }

    roundActive = true;
    timerEl.innerText = "⏳ Time Remaining: " + data.time + "s";
  } else {
    roundActive = false;
    timerEl.innerText = "🛑 Round Inactive";
    submitBtn.disabled = true;
  }
});

// ── LEADERBOARD ──
socket.on("updateScores", scores => {
  const leaderboardDiv = document.getElementById("leaderboard");
  leaderboardDiv.innerHTML = "";

  Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .forEach(([team, score], index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";
      row.innerHTML = `<strong>#${index + 1} ${team}</strong><span>${score} pts</span>`;
      leaderboardDiv.appendChild(row);
    });
});

// ── SUBMISSION BLOCKED ──
// ── UPDATE TEAMS ──
socket.on("updateTeams", teams => {
  const teamSelect = document.getElementById("teamSelect");
  teamSelect.innerHTML = "";
  teams.forEach(team => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    teamSelect.appendChild(option);
  });
});

// ── UPDATE DIFFICULTY ──
socket.on("updateDifficulty", diff => {
  console.log("Difficulty updated to:", diff);
  const diffElement = document.querySelector(".diff-value");
  if (diffElement) {
    diffElement.innerText = diff;
  }
});