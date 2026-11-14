// Punishment Appeal Page JavaScript

let currentUser = null;

async function initAppealPage() {
  try {
    const res = await fetch("/api/user");
    const data = await res.json();
    currentUser = data.loggedIn ? data.user : null;
    renderAuthState();
  } catch (err) {
    console.error("Auth check failed:", err);
  }
}

function renderAuthState() {
  const loginGate = document.getElementById("loginGateCard");
  const userBar = document.getElementById("userProfileBar");
  const appealCard = document.getElementById("appealCard");

  if (currentUser) {
    loginGate.style.display = "none";
    userBar.style.display = "flex";
    document.getElementById("userAvatar").src = currentUser.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png";
    document.getElementById("userTag").innerText = currentUser.tag || currentUser.username;
    appealCard.style.display = "block";
  } else {
    loginGate.style.display = "block";
    userBar.style.display = "none";
    appealCard.style.display = "none";
  }
}

async function handleAppealSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const originalText = submitBtn.innerHTML;

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>SUBMITTING APPEAL...</span>`;

  const formData = new FormData(form);
  const jsonBody = {};
  formData.forEach((val, key) => {
    jsonBody[key] = val;
  });

  try {
    const res = await fetch("/api/appeal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonBody)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      form.reset();
      document.getElementById("successModal").style.display = "flex";
    } else {
      alert("Error: " + (data.error || "Failed to submit appeal."));
    }
  } catch (err) {
    alert("Connection error occurred. Please try again.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

function closeSuccessModal() {
  document.getElementById("successModal").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  initAppealPage();
});
