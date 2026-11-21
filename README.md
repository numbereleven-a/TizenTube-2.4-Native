# TizenTube 2.4 Native

[README на русском](README_RU.md)

Native YouTube player with SponsorBlock for Samsung TVs running **Tizen 2.4**.

Unlike standard [TizenTube](https://github.com/reisxd/TizenTube) and [TizenTube-old-tizen](https://github.com/numbereleven-a/TizenTube-old-tizen), this app does **not** load the YouTube TV web interface and does **not** use HTML `<video>` or Media Source Extensions (MSE). Instead, it pairs a lightweight custom TV interface with a native ARM NaCl module (Pepper 42) that handles HTTPS/TLS 1.3 via Mbed TLS, demuxes MP4/WebM streams in the background with bounded native buffers, and feeds elementary streams directly into Samsung's hardware player (`ESPlayer`).

The app runs entirely on the TV. No computer, external proxy, or local companion service is needed during viewing.

> **Supported OS:** This app supports **Tizen 2.4** (ARM Samsung TVs with Pepper 42 NaCl). No other OS or Tizen version has been tested. If you prefer the standard YouTube TV HTML interface, see [TizenTube-old-tizen](https://github.com/numbereleven-a/TizenTube-old-tizen) or upstream [TizenTube](https://github.com/reisxd/TizenTube).

**Tested device:**

| TV | Tizen | Firmware | Confirmed operation |
|---|---|---|---|
| Samsung UE50KU6000 (KU6000 series) | 2.4.0 | T-JZL6DEUC-1260.1 | Custom UI, native playback up to 1080p60 H.264 and 2160p60 VP9 over TLS 1.3, SponsorBlock, Google QR sign-in, watch history |

| | |
|---|---|
| App name | TizenTube 2.4 Native |
| Supported OS | Samsung Smart TV — Tizen 2.4 (ARM NaCl / Pepper 42); no other OS tested |
| Playback engine | Native Mbed TLS + MP4/WebM demuxers + Samsung `ESPlayer` (no HTML `<video>` / MSE) |
| HTML version | [TizenTube-old-tizen](https://github.com/numbereleven-a/TizenTube-old-tizen) |
| License | GPL-3.0; see [LICENSE](LICENSE) and third-party notices in [`native/assets/`](native/assets/) |
| Release | [Download the installation package](https://github.com/numbereleven-a/TizenTube-2.4-Native/releases/latest) |

## Main difference from the standard HTML version

Standard [TizenTube](https://github.com/reisxd/TizenTube) and [TizenTube-old-tizen](https://github.com/numbereleven-a/TizenTube-old-tizen) load YouTube's official TV web interface inside the TV's old WebKit browser and play video through JavaScript and HTML5 MSE.

**TizenTube 2.4 Native** drops the YouTube TV HTML interface on WebKit and uses a lightweight custom TV UI paired with a native ARM NaCl module (Mbed TLS + MP4/WebM demuxers + Samsung `ESPlayer`). Because the TV does not have to load and run the heavy YouTube web app in WebKit, the application launches faster and stays noticeably more responsive during navigation, while media bytes remain inside bounded native buffers instead of passing through browser JS/MSE.

## Install

The release ZIP contains one unsigned `.wgt`. Sign it with a Samsung certificate profile that includes your TV's DUID before installation. Personal certificates and device-specific signatures are not included in the download.

1. Download the release ZIP from the [latest release](https://github.com/numbereleven-a/TizenTube-2.4-Native/releases/latest) and extract the `.wgt`. For the Tizen Studio CLI steps below, open the `.wgt` as a ZIP and extract its contents into `extracted_folder`.
2. Install Tizen Studio with Samsung TV Extension and Certificate Manager.
3. Enable Developer Mode on your TV, connect it, and create a Samsung certificate profile for your TV's DUID. See Samsung's [certificate guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html) and [TV connection guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
4. Package and sign the widget with your certificate profile using Tizen Studio or CLI:
   ```text
   tizen package -t wgt -s YOUR_CERTIFICATE_PROFILE -o out -- extracted_folder
   ```
5. Install the signed WGT on the connected TV and launch **TizenTube 2.4 Native** from Apps.

The app is not distributed through Samsung Apps. Building from source is described below.

### Updating an existing installation

Sign updates with the same author certificate and install over the existing application to preserve saved accounts, settings, and local resume positions. An expired or revoked authorization can still require signing in again. Uninstalling the application clears its local data.

## Features

- **Native playback pipeline:** HTTPS/TLS 1.3 and TLS 1.2 (Mbed TLS with certificate and hostname verification), background MP4/WebM demuxing with bounded native buffers, and hardware decoding via Samsung's Pepper 42 `ESPlayer`.
- **Video and audio formats:** H.264 up to 1080p60 and VP9 (profile 0) up to 2160p60 (4K60) with AAC audio. Configurable preferred codec and maximum resolution (default: H.264 up to 1080p).
- **Custom TV navigation:** Sidebar with Home, Search, Subscriptions (chronological upload feed + My Channels), Library, History, Watch Later, and Liked videos, plus channel navigation from the player (`Go to channel`).
- **Built-in search:** Russian/English on-screen keyboard with a digit row, live search suggestions, and direct lookup by YouTube URL or video ID.
- **Google accounts:** On-screen QR code sign-in, multiple saved accounts in private TV storage, watch history reporting, likes, and channel subscriptions.
- **SponsorBlock:** Eight independently configurable skip categories (defaults: sponsors, self-promotion, interaction reminders), green timeline markers, and optional skip notifications.
- **Playback convenience:** Creator chapters, "Go to beginning", YouTube JSON3 captions, manual quality switching during playback, optional autoplay of the next suggested video, and local resume positions for the last 100 videos.
- **Resilient media transport:** Bounded retries on new connections for transient media HTTP 503/403 errors and TLS connection drops, plus account-client stream fallback when signed in.

## Controls

| Button | Action |
|---|---|
| Arrows | Navigate sidebar, video cards, and built-in keyboard |
| OK (during playback) | Show seek bar without pausing; press OK again on the seek bar to toggle pause/play |
| Left / Right (during playback) | Accumulate seek offset for 650 ms, preview target time, then seek |
| Up (during playback) | Open creator chapters, time jumps, and "Go to beginning" |
| Down (during playback) | Select player action buttons (quality, captions, SponsorBlock, like, subscribe, go to channel) |
| Back | Close overlay/menu, or return to the previous list |

Additional control details:

- The playback overlay hides automatically after 5 seconds without remote input, including while paused.
- Settings includes **"After seeking, pause until OK"** (off by default): manual seeks, chapter jumps, and "Go to beginning" stay paused until you press OK. SponsorBlock skips and quality-change resumes keep normal playback state.
- Changing quality during playback reopens native streams at the current position (manual quality selection, not adaptive bitrate switching). Higher tiers can switch from H.264 to VP9 automatically.
- In Search, pressing Up above the digit row selects search suggestions; Down from the last suggestion returns to the keyboard.

## Settings, accounts, and diagnostics

- **Interface languages:** Russian and English.
- **Home recommendations:** Can be hidden independently of Search and Subscriptions (does not affect Samsung's TV launcher recommendations).
- **Accounts:** Multiple QR sign-ins are kept in private TV storage; refresh sessions remain on the TV and access tokens stay in memory only. Adding an account preserves existing sign-ins; signing out removes only the active account.
- **Privacy and history:** Watch history reporting starts after 5 seconds of actual playback and can be paused in Settings. Searches run through the signed-out search client and are not added to account history. Global history controls open Google's activity settings via QR code on your phone.
- **Reset settings:** Requires confirmation and removes all local accounts, preferences, resume positions, decipher cache, and diagnostics without affecting Google account history.
- **Local diagnostics:** Settings includes a bounded local Diagnostics journal that survives restarts and records numeric player/HTTP codes, queue sizes, playback positions, and incomplete shutdown markers. It excludes video IDs, titles, account names, stream URLs, tokens, and response bodies, and never uploads data automatically.

## Requirements, compatibility, and limitations

- **Supported OS:** Supports **Tizen 2.4**; tested on **Samsung UE50KU6000** (`Tizen 2.4.0`, `T-JZL6DEUC-1260.1`). No other OS or Tizen version has been tested, and compatibility with every Tizen 2.4 model or firmware is not guaranteed.
- **Supported streams:** Finite, directly accessible VOD streams only. Live streams are not supported.
- **Excluded video formats:** AV1 and HDR / VP9 profile 2 (including legacy `vp9.2`) are excluded; VP9 uses SDR profile 0.
- **Stream decipher worker:** When authenticated TV streams require an `n` transform, a Web Worker processes the matching YouTube player script and caches the prepared code on the TV for that player version. Initial preparation for a new YouTube player version takes roughly 40 seconds on the KU6000; subsequent launches reuse the cache. Regular direct streams do not invoke the worker.
- **Long-session stability and API changes:** Multi-hour playback stability still requires broader real-world testing. YouTube's private API can change independently of this project.

## Build from source

Requirements: Node.js, PowerShell, Samsung Pepper 42 ARM NaCl SDK, Mbed TLS 3.6.7, zlib 1.3.2, [yt-dlp EJS 0.8.0](https://pypi.org/project/yt-dlp-ejs/0.8.0/) (`lib.min.js` and `core.min.js`), and Tizen Studio CLI with a Samsung TV certificate profile.

Pass your local dependency paths as parameters:

```powershell
./scripts/build-native.ps1 -SdkRoot SDK_ROOT -MbedTlsRoot MBEDTLS_ROOT -ZlibRoot ZLIB_ROOT
npm ci --ignore-scripts
node scripts/build-decipher.cjs EJS_ROOT
node --test test/player.test.js test/account.test.js test/playback-controls.test.js test/history-diagnostics.test.js test/settings.test.js test/decipher.test.js test/player-cache.test.js test/search-keyboard.test.js test/shell.test.js
./scripts/package.ps1 -TizenCli TIZEN_CLI -CertificateProfile TV_PROFILE
```

Notes on building:

- Native libraries are compiled on the first build. Built packages are stored in `artifacts/<version>/`; increment the version in `app/config.xml` before repackaging.
- User builds produce an unsigned ZIP containing the widget files plus a WGT signed for your local TV profile. Distribute only the unsigned ZIP; installation on another TV requires signing with that TV's certificate.
- The standalone host demuxer tests (`test/demuxer.cc` and `test/demuxer-limits.cc`) can be compiled with a C++14 compiler against `native/src/media/*.cpp`. Materialized fragments are bounded to 64 MiB and 65,536 samples per track.

## Credits and license

GPL-3.0; see [LICENSE](LICENSE).

- MP4/WebM demuxers are adapted from [OmegaTube](https://github.com/IIyn/omegatube).
- NaCl TLS transport is adapted from [TizenTube-old-tizen](https://github.com/numbereleven-a/TizenTube-old-tizen).
- SponsorBlock data is provided by [SponsorBlock](https://sponsor.ajay.app).
- QR code generation uses [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).
- The decipher worker uses yt-dlp EJS (Unlicense), Meriyah (ISC), Astring (MIT), core-js (MIT), and Babel (MIT).
- Third-party license notices are included in [`native/assets/`](native/assets/) and packaged into the widget.

[![Downloads](https://img.shields.io/github/downloads/numbereleven-a/TizenTube-2.4-Native/total?label=Downloads)](https://github.com/numbereleven-a/TizenTube-2.4-Native/releases)
