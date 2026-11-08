<div align="center">

<img src="docs/assets/icon-256.png" width="120" alt="MultiMessenger logo" />

# MultiMessenger

### All your messengers in one window. Each with its own proxy.

WhatsApp · Telegram · Instagram · X · Gmail · Discord · ChatGPT · Claude · and 20 more, in a single sidebar.

[![Download](https://img.shields.io/github/v/release/nissay87/MultiMessenger?style=for-the-badge&label=Download&color=6d4aff&logo=windows&logoColor=white)](https://github.com/nissay87/MultiMessenger/releases/latest)
[![Website](https://img.shields.io/badge/Website-nissay87.github.io-181b3a?style=for-the-badge&logo=githubpages&logoColor=white)](https://nissay87.github.io/MultiMessenger/)
[![License](https://img.shields.io/badge/License-MIT-34d399?style=for-the-badge)](LICENSE)
![Platform](https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=for-the-badge&logo=windows11&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-33-47848f?style=for-the-badge&logo=electron&logoColor=white)

**[⬇ Download for Windows](https://github.com/nissay87/MultiMessenger/releases/latest)** &nbsp;·&nbsp; **[🌐 Website](https://nissay87.github.io/MultiMessenger/)** &nbsp;·&nbsp; **[🐛 Report a problem](https://github.com/nissay87/MultiMessenger/issues)**

<br />

<img src="docs/assets/app.png" alt="MultiMessenger window: a dark sidebar with WhatsApp, Telegram, Instagram, Gmail and other services, unread counts and proxy tags" width="900" />

</div>

---

## Why MultiMessenger?

You have a dozen tabs open: WhatsApp, Telegram, mail, three AI chats, Instagram. Some need a proxy, some must not use one, and two of them need a second account. A normal browser makes that painful.

**MultiMessenger gives every service its own space**: its own login, its own proxy, its own zoom and its own notifications, all one click away in a clean sidebar.

> Free, open source and private. No account, no tracking, no server. Everything stays on your computer.

---

## ✨ Highlights

| | |
|---|---|
| 🧭 **24 services built in** | Messaging, work, AI assistants and video, plus **any website** through a custom URL. |
| 🛡️ **A proxy for each service** | HTTP, HTTPS, SOCKS4 or SOCKS5, with optional username and password (SOCKS4 too). Proxy one service, leave another direct. |
| 👥 **Many accounts** | Every service has its own isolated session. Add WhatsApp twice for two numbers. |
| 🔔 **Real notifications** | Website notifications become Windows notifications. Unread counts on the sidebar, the taskbar and the tray. |
| 🗂️ **Workspaces** | Group services into *Social media*, *AI*, *Mail*, *Work* and switch with one click. |
| ⬇️ **Video downloader** | Pick the exact YouTube quality, or download Instagram and Facebook videos in one click. MP4 plus the MKV original. |
| 🎨 **14 themes** | From Windows 11 and GNOME to Windows XP, Classic Mac, MS-DOS and Plan 9. |
| 🔍 **Zoom per service** | Each service remembers its own zoom. |
| 😴 **Always on or asleep** | Keep a service running, or unload it after a few minutes to save memory. |
| 🚀 **Start with Windows** | Optionally minimized to the tray. |

---

## 🧭 Supported services

| Group | Services |
|---|---|
| **Messaging and social** | WhatsApp, Telegram, Instagram, X (Twitter), Facebook, Facebook Messenger, Discord, Element / Matrix |
| **Work** | Gmail, Google Chat, Microsoft Teams, Skype for Business*, Mattermost*, LinkedIn |
| **AI assistants** | ChatGPT, Claude, Gemini, Grok, DeepSeek, GLM (Z.ai), Perplexity, Microsoft Copilot |
| **Video** | YouTube |
| **Anything else** | **Web app (custom URL)**: type an address and it gets its own login, icon and proxy |

\* Skype for Business and Mattermost are hosted by your organization, so you enter your own server address.

The sidebar starts **empty**. You add only the services you want.

---

## 🛡️ A proxy for each service

<table>
<tr>
<td width="55%" valign="top">

Send WhatsApp through one server, keep Gmail on your normal connection, and put Instagram behind another. Each service has its own switch.

- Choose **HTTP, HTTPS, SOCKS4 or SOCKS5**
- Type the address and port, for example `127.0.0.1` and `8080`
- Add a username and password when needed (**SOCKS4 included**)
- **Save & test connection** shows the exit IP the service really uses and how fast the proxy answers
- Proxy passwords are stored encrypted with Windows
- A small tag in the sidebar shows which services use a proxy

</td>
<td width="45%" align="center">

<img src="docs/assets/dialog.png" alt="Service settings dialog with proxy options" width="300" />

</td>
</tr>
</table>

Need a second account? Add the service again, or open its settings and choose **Sign out & clear data** to start fresh. The proxy settings are kept.

---

## 🔔 Stays connected, tells you when something arrives

- **Notifications**: a website's own notifications become native Windows notifications. Click one to open that service.
- **Unread counts**: red numbers on the sidebar, the taskbar icon and the tray tooltip. Mute any service.
- **Tray and taskbar**: minimize goes to the taskbar, closing the window hides the app in the tray. On Windows 11 the app asks to keep its tray icon visible instead of tucked under the hidden **^** area (Settings → *Keep the tray icon visible*). On Windows 10, drag the icon out of the **^** area once, or use the *open taskbar settings* button.
- **Always on or asleep**: choose per service. Always on keeps messages arriving; sleep unloads a service after the minutes you choose to save memory.
- **Start with Windows**, optionally minimized to the tray.

<div align="center">
<img src="docs/assets/settings.png" alt="Settings dialog" width="380" />
&nbsp;
<img src="docs/assets/workspaces.png" alt="Workspace bar" width="170" />
</div>

---

## ⬇️ Video downloader

- **YouTube**: a green **Download as** button next to *Subscribe* lists **every resolution the video has**, plus MP3 and original audio. You get exactly the quality you choose.
- **Instagram**: a download icon next to *Save* on every video post and on Reels. Profiles get *Download All* for the posts already loaded.
- **Facebook and X**: the **⬇ Video** button in the top bar.
- **Any video link**: right-click it and choose *Download video*.
- Every video is saved as **MP4**, and the **MKV original is kept next to it**.
- Your service's own sign-in and proxy are used.
- One **Downloads** section shows progress, pause, cancel, retry, open and show in folder.

Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, fetched once on first use. Only download what you have the right to.

<div align="center">
<img src="docs/assets/downloads.png" alt="Downloads section with finished video and MP3 downloads" width="820" />
</div>

---

## 🎨 Themes, fonts and zoom

Fourteen themes, a sidebar icon size from 16 to 64 px, and any font installed on your PC, for the app and for the text inside chats (for example Tahoma).

<div align="center">

| Windows XP | Windows 11 | KDE Plasma | GNOME |
|:---:|:---:|:---:|:---:|
| <img src="docs/assets/theme_xp.png" width="150" /> | <img src="docs/assets/theme_win11.png" width="150" /> | <img src="docs/assets/theme_kde.png" width="150" /> | <img src="docs/assets/theme_gnome.png" width="150" /> |

| Classic Mac | MS-DOS | 32-bit color | High contrast |
|:---:|:---:|:---:|:---:|
| <img src="docs/assets/theme_mac.png" width="150" /> | <img src="docs/assets/theme_dos.png" width="150" /> | <img src="docs/assets/theme_bit32.png" width="150" /> | <img src="docs/assets/theme_hc.png" width="150" /> |

</div>

Also included: the default Dark theme, Xfce, Plan 9, and 2-bit, 8-bit and 16-bit color.

Zoom each service with **Ctrl +**, **Ctrl -**, **Ctrl 0** or **Ctrl + mouse wheel**. Each one remembers its own level.

---

## 📥 Install

1. Open the **[Releases page](https://github.com/nissay87/MultiMessenger/releases/latest)**.
2. Download `MultiMessenger Setup x.y.z.exe` and run it.
3. Start **MultiMessenger** from the Start menu or the desktop shortcut.

> The installer is **not code-signed**, so Windows SmartScreen may show *"Windows protected your PC"*. Choose **More info → Run anyway**. If you prefer not to trust a prebuilt file, run it from source (below).

---

## 🛠️ Run from source

You need [Node.js](https://nodejs.org/) (current LTS) and [Git](https://git-scm.com/).

```bash
git clone https://github.com/nissay87/MultiMessenger.git
cd MultiMessenger
```

Then, in the project folder:

```bash
npm install
npm install-scripts approve electron
node node_modules\electron\install.js
npm start
```

What each line does:

| Command | Purpose |
|---|---|
| `npm install` | Downloads the dependencies. |
| `npm install-scripts approve electron` | Newer npm versions block Electron's download step. This allows it. |
| `node node_modules\electron\install.js` | Downloads the Electron program itself. On macOS or Linux use `/` instead of `\`. |
| `npm start` | Starts the app. |

After the first time, only `npm start` is needed.

<details>
<summary><b>The Electron download stalls or fails?</b></summary>

Your network may be blocking GitHub. Use a mirror, then run the install step again:

```bat
:: Windows (cmd)
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node node_modules\electron\install.js
```

```bash
# macOS / Linux
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

Do not run `npm audit fix --force`. The warnings come from the build tooling and do not affect the running app.

</details>

---

## 📦 Build your own installer

Open the terminal **as Administrator** (or turn on Developer Mode in Windows Settings), then:

```bash
npm run dist            # installer (.exe)
npm run dist:portable   # single portable .exe
npm run dist:msi        # .msi installer
```

The files appear in the `dist` folder. To publish: **GitHub → Releases → Draft a new release**, create a tag such as `v1.3.17`, attach the files from `dist`, and publish.

<details>
<summary><b>Build helpers fail to download?</b></summary>

```bat
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

</details>

---

## ⚙️ How it works

- Every service is an Electron `<webview>` with its own persistent partition (`persist:svc-<id>`), so logins and proxies never mix.
- HTTP and HTTPS proxies are set per partition with Chromium's native proxy login.
- Chromium cannot sign in to SOCKS proxies. For SOCKS **with** a username and password, [`relay.js`](relay.js) starts a small local HTTP proxy on `127.0.0.1` that forwards through the SOCKS server.
- [`webview-preload.js`](webview-preload.js) replaces the page's `Notification` API with one that reports to the app, which shows a native notification. Unread counts come from the page title, such as `(3) WhatsApp`.

```
main.js                Electron main process: window, tray, proxies, notifications, settings
videodl.js             video downloader (yt-dlp and ffmpeg)
preload.js             safe bridge between the app window and the main process
webview-preload.js     runs inside each service page (notifications, download buttons)
relay.js               local HTTP-to-SOCKS bridge for SOCKS logins
catalog.json           the list of built-in services
renderer/              the app's interface (HTML, CSS, JS, themes, service icons)
assets/                app, window and tray icons (shipped inside the app)
build/                 installer icon files
docs/                  the GitHub Pages website
```

---

## 🔒 Privacy

MultiMessenger has **no accounts, no analytics and no server of its own**. Services, logins and settings are stored on your computer in `%APPDATA%\multi-messenger`. Proxy passwords are encrypted with the operating system's key store. The only request the app makes for itself is the exit-IP check to `api.ipify.org`, and only when you press **Save & test connection**.

## ⚠️ Known limits

- **Windows is the supported system.** The code is cross-platform Electron, but tray icons, taskbar badges and start-at-login are designed for Windows and are untested elsewhere.
- Google and Facebook sometimes refuse sign-in in embedded browsers. The app presents itself as normal Chrome, which usually works, but a provider can still block it.
- A sleeping service is unloaded and cannot show notifications until you open it.
- Websites change often. If a service stops working, reload it, clear its cache, or [open an issue](https://github.com/nissay87/MultiMessenger/issues).

## 🙏 Credits and disclaimer

Made by **[nissay87](https://github.com/nissay87)**.

Video downloads use [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/). Service logos are from [Simple Icons](https://simpleicons.org/).

MultiMessenger is an independent project. It is not affiliated with, endorsed by or sponsored by any of the services it can open. Names and logos belong to their owners and are used only to identify the services. You are responsible for following each service's terms of use.

## 📄 License

[MIT](LICENSE) © nissay87

---

<div align="center">

**If MultiMessenger saves you time, please ⭐ star the repository. It helps others find it.**

</div>
