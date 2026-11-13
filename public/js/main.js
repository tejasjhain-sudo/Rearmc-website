// RearMC Clean Client Controller
let currentUser = null;
let isMusicPlaying = false;

async function checkAuth() {
  try {
    const res = await fetch("/api/user");
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      const authUserElem = document.getElementById("authUserName");
      const authSkinElem = document.getElementById("authSkinImg");
      if (authUserElem) authUserElem.textContent = data.user.global_name || data.user.username;
      if (authSkinElem) {
        if (data.user.avatar) {
          authSkinElem.src = `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png?size=64`;
        }
      }
    }
  } catch (err) {
    console.error("Auth check failed:", err);
  }
}

function handleAuthClick() {
  if (currentUser) {
    window.location.href = "/apply";
  } else {
    window.location.href = "/auth/discord?redirect=" + encodeURIComponent(window.location.pathname);
  }
}

function copyServerIP() {
  const ip = "play.rearmc.net";
  navigator.clipboard.writeText(ip).then(() => {
    const feedback = document.getElementById("copyFeedback");
    if (feedback) {
      const orig = feedback.textContent;
      feedback.textContent = "COPIED!";
      feedback.style.color = "#4ade80";
      setTimeout(() => {
        feedback.textContent = orig;
        feedback.style.color = "";
      }, 2000);
    }
  }).catch(() => {
    prompt("Copy Server IP:", ip);
  });
}

function initMusic() {
  const audio = document.getElementById("bgMusic");
  const btn = document.getElementById("musicToggleBtn");
  const status = document.getElementById("musicStatusText");
  if (!audio) return;

  audio.volume = 0.35;

  const startAudio = () => {
    audio.play().then(() => {
      isMusicPlaying = true;
      if (btn) btn.classList.remove("paused");
      if (status) status.textContent = "Music Playing";
    }).catch(() => {
      // Browser autoplay policy might require first user click
      isMusicPlaying = false;
      if (btn) btn.classList.add("paused");
      if (status) status.textContent = "Click to Play Music";
    });
    document.removeEventListener("click", startAudio);
  };

  // Try direct autoplay, or attach to first user interaction
  audio.play().then(() => {
    isMusicPlaying = true;
    if (btn) btn.classList.remove("paused");
    if (status) status.textContent = "Music Playing";
  }).catch(() => {
    if (btn) btn.classList.add("paused");
    if (status) status.textContent = "Click to Play Music";
    document.addEventListener("click", startAudio, { once: true });
  });
}

function toggleMusic() {
  const audio = document.getElementById("bgMusic");
  const btn = document.getElementById("musicToggleBtn");
  const status = document.getElementById("musicStatusText");
  if (!audio) return;

  if (isMusicPlaying) {
    audio.pause();
    isMusicPlaying = false;
    if (btn) btn.classList.add("paused");
    if (status) status.textContent = "Music Paused";
  } else {
    audio.play().then(() => {
      isMusicPlaying = true;
      if (btn) btn.classList.remove("paused");
      if (status) status.textContent = "Music Playing";
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  initMusic();
});
