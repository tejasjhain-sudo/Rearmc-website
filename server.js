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

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1570030593008468060";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "3uaRlenqxMB_inqri_61jrxCqLOOELyT";
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "https://www.rearmc.net/auth/discord/callback";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const STAFF_LOGS_NAME = process.env.STAFF_LOGS_CHANNEL_NAME || "staff-application-logs";
const MEDIA_LOGS_NAME = process.env.MEDIA_LOGS_CHANNEL_NAME || "media-application-logs";

// Simple in-memory user sessions (tokens stored in cookie)
const sessions = new Map();

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

    const sessionId = "sess_" + Math.random().toString(36).substring(2) + Date.now();
    sessions.set(sessionId, {
      ...user,
      tag: user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : user.username,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : "https://cdn.discordapp.com/embed/avatars/0.png"
    });

    res.cookie("rearmc_session", sessionId, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: true, path: "/" });
    res.redirect(redirectTarget);
  } catch (err) {
    console.error("Auth callback error:", err);
    res.redirect("/?error=server_error");
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  const sid = req.cookies.rearmc_session;
  if (sid) sessions.delete(sid);
  res.clearCookie("rearmc_session");
  res.redirect("/");
});

// Current User API
app.get("/api/user", (req, res) => {
  const sid = req.cookies.rearmc_session;
  if (!sid || !sessions.has(sid)) {
    return res.json({ loggedIn: false });
  }
  return res.json({ loggedIn: true, user: sessions.get(sid) });
});

// Helper: send discord webhook/bot message
async function sendDiscordLog(type, formData, user) {
  if (!BOT_TOKEN) return false;
  try {
    // 1. Get guilds where bot is in
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const guilds = await guildsRes.json();
    if (!Array.isArray(guilds) || guilds.length === 0) return false;
    const guildId = guilds[0].id;

    // 2. Find or create logs channel
    const targetChannelName = type === "staff" ? STAFF_LOGS_NAME : MEDIA_LOGS_NAME;
    const channelsRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });
    const channels = await channelsRes.json();
    let targetChannel = Array.isArray(channels) ? channels.find(c => c.name.toLowerCase() === targetChannelName.toLowerCase()) : null;

    if (!targetChannel) {
      // Create channel
      const createRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: targetChannelName,
          type: 0,
          topic: `Logs channel for ${type} applications`
        })
      });
      targetChannel = await createRes.json();
    }

    if (!targetChannel || !targetChannel.id) return false;

    // 3. Construct Embed & Approve/Decline Buttons
    const appId = `app_${type}_${user.id}_${Date.now()}`;
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
          color: type === "staff" ? 0xDC2626 : 0x9333EA,
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
              custom_id: `app_approve_${user.id}_${guildId}_${type}`,
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

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${targetChannel.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    return msgRes.ok;
  } catch (err) {
    console.error("Error sending discord log:", err);
    return false;
  }
}

// Submit Application
app.post("/api/apply/:type", async (req, res) => {
  const { type } = req.params;
  const sid = req.cookies.rearmc_session;
  if (!sid || !sessions.has(sid)) {
    return res.status(401).json({ error: "Please login with Discord first." });
  }

  const user = sessions.get(sid);
  const formData = req.body;

  // Persist locally
  const dataDir = path.join(__dirname, "data");
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

  // Send to Discord bot log channel with buttons
  await sendDiscordLog(type, formData, user);

  return res.json({ success: true, message: "Application submitted successfully!" });
});

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`RearMC Web Server running at http://localhost:${PORT}`);
  });
}

export default app;
