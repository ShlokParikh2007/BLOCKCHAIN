const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();

let roundActive = false;
let roundTime = 0;
let timerInterval = null;
let roundSubmissions = new Set();

let numTeams = 4;
let difficulty = 0;
let teamNames = [];

const ADMIN_PASSWORD = "admin123";

app.use(express.json());

app.post("/admin-login", (req, res) => {
  const { password } = req.body;
  res.json({ success: password === ADMIN_PASSWORD });
});

let currentTransaction = null;
let currentSubmission = null;
let teamScores = {};

// Verification voting state
let verificationVotes = {
  yes: new Set(),
  no: new Set(),
  eligible: new Set()
};

const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
app.use(express.static("public"));

const players = [];

// Initialize teams
function initializeTeams() {
  teamNames = [];
  teamScores = {};
  for (let i = 1; i <= numTeams; i++) {
    const teamName = `Team ${String.fromCharCode(64 + i)}`;
    teamNames.push(teamName);
    teamScores[teamName] = 0;
  }
  console.log("🎮 Teams initialized:", teamNames);
  console.log("📊 Difficulty set to:", difficulty);
}

// Initialize with default values
initializeTeams();

function broadcastVoteState() {
  const totalEligible = verificationVotes.eligible.size;
  const yesCount = verificationVotes.yes.size;
  const noCount = verificationVotes.no.size;
  const votedCount = yesCount + noCount;
  const yesPercent = totalEligible > 0 ? Math.round((yesCount / totalEligible) * 100) : 0;
  const allVoted = totalEligible > 0 && votedCount >= totalEligible;

  io.emit("voteUpdate", {
    yesCount,
    noCount,
    totalEligible,
    votedCount,
    yesPercent,
    allVoted,
    submittingTeam: currentSubmission ? currentSubmission.team : null
  });

  if (allVoted) {
    resolveVerification();
  }
}

function resolveVerification() {
  if (!currentSubmission) return;

  const totalEligible = verificationVotes.eligible.size;
  const yesCount = verificationVotes.yes.size;
  const yesPercent = totalEligible > 0 ? Math.round((yesCount / totalEligible) * 100) : 0;
  const approved = yesPercent > 50;

  if (approved) {
    // Create block with current transaction data
    const block = {
      transaction: {
        sender: currentTransaction.sender,
        receiver: currentTransaction.receiver,
        amount: currentTransaction.amount
      },
      team: currentSubmission.team,
      nonce: currentSubmission.nonce,
      hash: currentSubmission.hash,
      status: "Verified"
    };

    teamScores[currentSubmission.team] += 100;

    io.emit("verificationResult", {
      approved: true,
      yesPercent,
      yesCount,
      totalEligible,
      team: currentSubmission.team
    });
    io.emit("blockCreated", block);
    io.emit("updateScores", teamScores);

    console.log("✅ Block verified:", block);

    currentSubmission = null;
    verificationVotes = { yes: new Set(), no: new Set(), eligible: new Set() };
  } else {
    io.emit("verificationResult", {
      approved: false,
      yesPercent,
      yesCount,
      totalEligible,
      team: currentSubmission.team
    });

    console.log("❌ Block rejected");

    currentSubmission = null;
    verificationVotes = { yes: new Set(), no: new Set(), eligible: new Set() };
  }
}

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.emit("updatePlayers", players);
  socket.emit("updateScores", teamScores);
  socket.emit("updateTeams", teamNames);
  socket.emit("updateDifficulty", difficulty);

  if (currentTransaction) {
    socket.emit("transactionData", currentTransaction);
  }

  if (currentSubmission) {
    broadcastVoteState();
  }

  // ── ADMIN: UPDATE CONFIG ──
  socket.on("updateConfig", (data) => {
    numTeams = data.numTeams;
    difficulty = data.difficulty;
    initializeTeams();
    
    // Clear players and broadcast new config
    players.length = 0;
    io.emit("updateTeams", teamNames);
    socket.emit("updatePlayers", []);
    io.emit("updateScores", teamScores);
    io.emit("updateDifficulty", difficulty);
  });

  // ── ROUND CONTROLS (admin) ──
  socket.on("startRound", (duration) => {
    if (roundActive) return;
    roundActive = true;
    roundTime = duration;
    roundSubmissions.clear();

    io.emit("roundStatus", { active: true, time: roundTime });

    timerInterval = setInterval(() => {
      roundTime--;
      io.emit("roundStatus", { active: true, time: roundTime });

      if (roundTime <= 0) {
        clearInterval(timerInterval);
        roundActive = false;
        io.emit("roundStatus", { active: false, time: 0 });
      }
    }, 1000);
  });

  socket.on("endRound", () => {
    clearInterval(timerInterval);
    roundActive = false;
    io.emit("roundStatus", { active: false, time: 0 });
  });

  // ── UPDATE TRANSACTION ──
  socket.on("updateTransaction", (data) => {
    currentTransaction = {
      sender: data.sender,
      receiver: data.receiver,
      amount: data.amount
    };
    io.emit("transactionData", currentTransaction);
    console.log("📦 Transaction updated:", currentTransaction);
  });

  // ── JOIN ──
  socket.on("joinGame", ({ name, team }) => {
    players.push({ id: socket.id, name, team });
    socket.emit("joinSuccess");
    io.emit("updatePlayers", players);
  });

  // ── SUBMIT RESULT ──
  socket.on("submitResult", ({ nonce, hash }) => {
    if (!roundActive) {
      socket.emit("submissionBlocked", "Round is not active");
      return;
    }

    if (roundSubmissions.has(socket.id)) {
      socket.emit("submissionBlocked", "You already submitted this round");
      return;
    }

    const player = players.find(p => p.id === socket.id);
    if (!player) return;

    roundSubmissions.add(socket.id);

    currentSubmission = { team: player.team, nonce, hash, verified: false };

    verificationVotes = {
      yes: new Set(),
      no: new Set(),
      eligible: new Set(
        players
          .filter(p => p.team !== player.team)
          .map(p => p.id)
      )
    };

    io.emit("newSubmission", {
      team: player.team,
      nonce,
      hash,
      totalEligible: verificationVotes.eligible.size
    });

    broadcastVoteState();
  });

  // ── VOTE ──
  socket.on("castVote", ({ vote }) => {
    if (!currentSubmission) return;
    if (!verificationVotes.eligible.has(socket.id)) return;
    if (verificationVotes.yes.has(socket.id) || verificationVotes.no.has(socket.id)) return;

    if (vote === "yes") {
      verificationVotes.yes.add(socket.id);
    } else {
      verificationVotes.no.add(socket.id);
    }

    broadcastVoteState();
  });

  // ── DISCONNECT ──
  socket.on("disconnect", () => {
    const index = players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      verificationVotes.eligible.delete(socket.id);
      players.splice(index, 1);
    }
    io.emit("updatePlayers", players);

    if (currentSubmission && verificationVotes.eligible.size > 0) {
      broadcastVoteState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});