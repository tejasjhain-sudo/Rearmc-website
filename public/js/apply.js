// Applications Page (BananaSMP Style) JavaScript

let currentTab = "staff";
let currentUser = null;

async function initApplyPage() {
  // Check hash in URL (e.g., /apply#media)
  const hash = window.location.hash.replace("#", "").toLowerCase();
  if (hash === "media") {
    switchTab("media");
  } else {
    switchTab("staff");
  }

  // Fetch logged in status
  try {
    const res = await fetch("/api/user");
    const data = await res.json();
    currentUser = data.loggedIn ? data.user : null;
    renderAuthState();
  } catch (err) {
    console.error("Auth check failed:", err);
  }
}

function switchTab(tab) {
  currentTab = tab;
  const staffBtn = document.getElementById("tabStaffBtn");
  const mediaBtn = document.getElementById("tabMediaBtn");
  const staffCard = document.getElementById("staffCard");
  const mediaCard = document.getElementById("mediaCard");

  if (tab === "staff") {
    staffBtn.classList.add("active");
    mediaBtn.classList.remove("active");
    if (currentUser) {
      staffCard.style.display = "block";
      mediaCard.style.display = "none";
    }
  } else {
    mediaBtn.classList.add("active");
    staffBtn.classList.remove("active");
    if (currentUser) {
      mediaCard.style.display = "block";
      staffCard.style.display = "none";
    }
  }
}

function renderAuthState() {
  const loginGate = document.getElementById("loginGateCard");
  const userBar = document.getElementById("userProfileBar");
  const staffCard = document.getElementById("staffCard");
  const mediaCard = document.getElementById("mediaCard");
  const navAuth = document.getElementById("navAuth");

  if (currentUser) {
    // Hide login gate
    loginGate.style.display = "none";

    // Show user profile bar
    userBar.style.display = "flex";
    document.getElementById("userAvatar").src = currentUser.avatarUrl;
    document.getElementById("userTag").innerText = currentUser.tag || currentUser.username;

    // Show active tab form
    if (currentTab === "staff") {
      staffCard.style.display = "block";
      mediaCard.style.display = "none";
    } else {
      mediaCard.style.display = "block";
      staffCard.style.display = "none";
    }

    if (navAuth) {
      navAuth.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="${currentUser.avatarUrl}" style="width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid #ff2a2a;" />
          <span style="font-weight: 700; font-size: 0.9rem; color: #fff;">${currentUser.tag || currentUser.username}</span>
        </div>
      `;
    }
  } else {
    // Show login gate
    loginGate.style.display = "block";
    userBar.style.display = "none";
    staffCard.style.display = "none";
    mediaCard.style.display = "none";

    if (navAuth) {
      navAuth.innerHTML = `
        <a href="/auth/discord?redirect=/apply" class="btn-discord-login">
          Login with Discord
        </a>
      `;
    }
  }
}

async function handleFormSubmit(event, type) {
  event.preventDefault();
  const form = event.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const originalText = submitBtn.innerHTML;

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span>SUBMITTING...</span>`;

  const formData = new FormData(form);
  const jsonBody = {};
  formData.forEach((val, key) => {
    jsonBody[key] = val;
  });

  try {
    const res = await fetch(`/api/apply/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonBody)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      form.reset();
      document.getElementById("successModal").style.display = "flex";
    } else {
      alert("Error: " + (data.error || "Failed to submit application."));
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
  initApplyPage();
});
