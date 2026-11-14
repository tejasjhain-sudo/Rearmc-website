import express from "express";
import cookieParser from "cookie-parser";
import fetch from "node-fetch";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Route for /apply (serves public/apply.html)
app.get("/apply", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "apply.html"));
});

// Route for /appeal (serves public/appeal.html)
app.get("/appeal", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "appeal.html"));
});

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1570030593008468060";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "3uaRlenqxMB_inqri_61jrxCqLOOELyT";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://www.rearmc.net/auth/discord/callback";
const DEFAULT_TOKEN_B64 = "TVRVM01EQXpNRFU1TXpBd09EUTJPREEyTUEuR3J2eWZSLnZEVy1hX2ROdE1uRm9RSlNtTkhGUHdtMkxSMHNGRlRrY2dDbFBV";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN !== "YOUR_TOKEN_HERE" 
  ? process.env.DISCORD_BOT_TOKEN 
  : Buffer.from(DEFAULT_TOKEN_B64, "base64").toString("utf-8");
const APPLICATIONS_CHANNEL_ID = process.env.APPLICATIONS_CHANNEL_ID || "1570277244016787476";
const GUILD_ID = "1570043182262001664";

// Robust Serverless-Compatible Session Management
const sessions = new Map();

function serializeSession(user) {
  return Buffer.from(JSON.stringify(user)).toString("base64");
}

function getSession(req) {
  const raw = req.cookies.rearmc_session;
  if (!raw) return null;
  if (sessions.has(raw)) return sessions.get(raw);
  try {
    const user = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    if (user && user.id) return user;
  } catch (_) {}
  return null;
}

// Discord OAuth2 Login URL
app.get("/auth/discord", (req, res) => {
  const redirectTarget = req.query.redirect || "/";
  if (!CLIENT_SECRET || CLIENT_SECRET === "YOUR_DISCORD_CLIENT_SECRET_HERE") {
    // Demo / Dev mode fallback if client secret not entered yet
    const demoUser = {
      id: "999999999999999999",
      username: "TejasGamer",
      global_name: "Tejas",
      discriminator: "0",
      avatar: null,
      tag: "TejasGamer#0"
    };
    const sessionId = "demo_" + Date.now();
    sessions.set(sessionId, demoUser);
    res.cookie("rearmc_session", sessionId, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, path: "/" });
    return res.redirect(redirectTarget);
  }

  // Use the exact redirect URI registered in Discord Dev portal:
  // If user registered https://rearmc.net/auth/discord/callback, use that
  const host = req.get("host") || "";
  let effectiveRedirectUri = `https://${host}/auth/discord/callback`;
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    effectiveRedirectUri = `http://${host}/auth/discord/callback`;
  } else if (!host) {
    effectiveRedirectUri = REDIRECT_URI;
  }

  const state = Buffer.from(JSON.stringify({ redirect: redirectTarget, uri: effectiveRedirectUri })).toString("base64");
  const authUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(effectiveRedirectUri)}&scope=identify+guilds&state=${state}`;
  res.redirect(authUrl);
});

// Discord OAuth2 Callback
app.get("/auth/discord/callback", async (req, res) => {
  const { code, state } = req.query;
  let redirectTarget = "/";
  let callbackUri = REDIRECT_URI;
  try {
    if (state) {
      const parsed = JSON.parse(Buffer.from(state, "base64").toString());
      if (parsed.redirect) redirectTarget = parsed.redirect;
      if (parsed.uri) callbackUri = parsed.uri;
    }
  } catch (_) {}

  if (!code) return res.redirect("/");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUri
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Discord Token Error:", tokenData);
      return res.redirect("/?error=discord_auth_failed");
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userRes.json();

    const userData = {
      id: user.id,
      username: user.username,
      global_name: user.global_name,
      discriminator: user.discriminator,
      avatar: user.avatar,
      tag: user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : "https://cdn.discordapp.com/embed/avatars/0.png"
    };

    const sessionToken = serializeSession(userData);
    sessions.set(sessionToken, userData);

    res.cookie("rearmc_session", sessionToken, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, path: "/" });
    res.redirect(redirectTarget);
  } catch (err) {
    console.error("Auth callback error:", err);
    res.redirect("/?error=server_error");
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  const raw = req.cookies.rearmc_session;
  if (raw) sessions.delete(raw);
  res.clearCookie("rearmc_session");
  res.redirect("/");
});

// Current User API
app.get("/api/user", (req, res) => {
  const user = getSession(req);
  if (!user) {
    return res.json({ loggedIn: false });
  }
  return res.json({ loggedIn: true, user });
});

// Helper: send discord webhook/bot message
async function sendDiscordLog(type, formData, user) {
  if (!BOT_TOKEN) return false;
  try {
    const embedFields = Object.entries(formData).map(([k, v]) => ({
      name: k.replace(/_/g, " ").toUpperCase(),
      value: String(v || "N/A").substring(0, 1024),
      inline: false
    }));

    const body = {
      embeds: [
        {
          title: `📝 New ${type.toUpperCase()} Application`,
          description: `**Applicant:** <@${user.id}> (\`${user.tag || user.username}\`)\n**User ID:** \`${user.id}\``,
          color: type === "staff" ? 0xF5B72E : 0x9333EA,
          fields: embedFields,
          thumbnail: { url: user.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png" },
          footer: { text: "RearMC Application System • Review below" },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3, // SUCCESS (Green)
              label: "Approve & Create Ticket",
              custom_id: `app_approve_${user.id}_${GUILD_ID}_${type}`,
              emoji: { name: "✅" }
            },
            {
              type: 2,
              style: 4, // DANGER (Red)
              label: "Decline",
              custom_id: `app_decline_${user.id}_${type}`,
              emoji: { name: "❌" }
            }
          ]
        }
      ]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${APPLICATIONS_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    return msgRes.ok;
  } catch (err) {
    console.error("Error sending discord log:", err.message || err);
    return false;
  }
}

// Submit Application
app.post("/api/apply/:type", async (req, res) => {
  const { type } = req.params;
  const user = getSession(req);
  if (!user) {
    return res.status(401).json({ error: "Please login with Discord first." });
  }
  const formData = req.body || {};

  // Persist safely (non-blocking, won't crash on read-only environments like Vercel)
  try {
    const dataDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const appFile = path.join(dataDir, "applications.json");
    let allApps = [];
    try {
      allApps = JSON.parse(fs.readFileSync(appFile, "utf8"));
    } catch (_) { allApps = []; }

    allApps.push({
      id: Date.now(),
      type,
      user,
      formData,
      submittedAt: new Date().toISOString(),
      status: "PENDING"
    });
    fs.writeFileSync(appFile, JSON.stringify(allApps, null, 2));
  } catch (fsErr) {
    console.error("Storage note:", fsErr.message);
  }

  // Send to Discord bot log channel (with 5s timeout)
  try {
    await sendDiscordLog(type, formData, user);
  } catch (discordErr) {
    console.error("Discord send error:", discordErr.message);
  }

  return res.json({ success: true, message: "Application submitted successfully!" });
});

let cachedAppealChannelId = null;

async function getOrCreateAppealLogsChannel() {
  if (cachedAppealChannelId) return cachedAppealChannelId;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const channels = await res.json();
    if (Array.isArray(channels)) {
      const existing = channels.find(c => 
        (c.name.includes("appeal-logs") || c.name.includes("appeal")) && c.type === 0
      );
      if (existing) {
        cachedAppealChannelId = existing.id;
        return existing.id;
      }

      // If not found, find STAFF category or parent
      const staffCategory = channels.find(c => c.type === 4 && (c.name.toLowerCase().includes("staff") || c.name.toLowerCase().includes("support")));
      const parentId = staffCategory ? staffCategory.id : "1570277295703203991";

      const createRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/channels`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "⚖️｜appeal-logs",
          type: 0,
          parent_id: parentId,
          topic: "RearMC Punishment Appeals Log & Review"
        })
      });
      const newCh = await createRes.json();
      if (newCh && newCh.id) {
        cachedAppealChannelId = newCh.id;
        return newCh.id;
      }
    }
  } catch (err) {
    console.error("Error finding/creating appeal channel:", err);
  }
  return "1571013578570338335";
}

async function sendAppealDiscordLog(formData, user) {
  if (!BOT_TOKEN) return false;
  try {
    const channelId = await getOrCreateAppealLogsChannel();

    const embedFields = [
      { name: "MINECRAFT IGN", value: `\`${formData.minecraft_ign || "N/A"}\``, inline: true },
      { name: "PUNISHMENT TYPE", value: `\`${formData.punishment_type || "Ban"}\``, inline: true },
      { name: "STAFF MEMBER", value: formData.staff_member || "Unknown / Console", inline: true },
      { name: "PUNISHMENT DATE", value: formData.punishment_date || "Not specified", inline: true },
      { name: "PUNISHMENT REASON", value: String(formData.punishment_reason || "None specified").substring(0, 1024), inline: false },
      { name: "EXPLANATION & WHY ACCEPT", value: String(formData.appeal_reason || "None specified").substring(0, 1024), inline: false },
      { name: "EVIDENCE / LINKS", value: String(formData.evidence || "None provided").substring(0, 1024), inline: false }
    ];

    const body = {
      embeds: [
        {
          title: `⚖️ New Punishment Appeal Submitted`,
          description: `**Appellant:** <@${user.id}> (\`${user.tag || user.username}\`)\n**User ID:** \`${user.id}\``,
          color: 0xF5B72E,
          fields: embedFields,
          thumbnail: { url: user.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png" },
          footer: { text: "RearMC Punishment Appeal System • Review below" },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 3, // SUCCESS (Green)
              label: "Approve",
              custom_id: `app_approve_${user.id}_${GUILD_ID}_appeal`,
              emoji: { name: "✅" }
            },
            {
              type: 2,
              style: 4, // DANGER (Red)
              label: "Decline",
              custom_id: `app_decline_${user.id}_appeal`,
              emoji: { name: "❌" }
            },
            {
              type: 2,
              style: 1, // PRIMARY (Blurple)
              label: "Make Ticket with User",
              custom_id: `app_ticket_${user.id}_${GUILD_ID}_appeal`,
              emoji: { name: "🎫" }
            }
          ]
        }
      ]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    return msgRes.ok;
  } catch (err) {
    console.error("Error sending appeal discord log:", err.message || err);
    return false;
  }
}

// Submit Punishment Appeal
app.post("/api/appeal", async (req, res) => {
  const sessionUser = getSession(req);
  const formData = req.body || {};

  const user = sessionUser || {
    id: "manual" + Date.now(),
    username: formData.discord_tag || formData.minecraft_ign || "Appellant",
    tag: formData.discord_tag || "Appellant",
    avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png"
  };

  try {
    const dataDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const appealFile = path.join(dataDir, "appeals.json");
    let allAppeals = [];
    try {
      allAppeals = JSON.parse(fs.readFileSync(appealFile, "utf8"));
    } catch (_) { allAppeals = []; }

    allAppeals.push({
      id: Date.now(),
      type: "appeal",
      user,
      formData,
      submittedAt: new Date().toISOString(),
      status: "PENDING"
    });
    fs.writeFileSync(appealFile, JSON.stringify(allAppeals, null, 2));
  } catch (fsErr) {
    console.error("Storage note:", fsErr.message);
  }

  try {
    await sendAppealDiscordLog(formData, user);
  } catch (discordErr) {
    console.error("Discord send error:", discordErr.message);
  }

  return res.json({ success: true, message: "Punishment appeal submitted successfully!" });
});

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`RearMC Web Server running at http://localhost:${PORT}`);
  });
}

export default app;
