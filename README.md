# BestClient

PvP-re optimalizált Minecraft launcher és kliens a **BestPvP** hálózathoz.

- **Minecraft:** 1.21.11 (az utolsó kiadás, ami Java 21-en fut)
- **Mod loader:** Fabric Loader 0.19.3
- **Launcher:** Electron 43 + Next.js 16 + TypeScript
- **Rögzített szerver:** `bestpvp.eu` — a launcher minden indítás előtt visszaírja a szerverlista elejére

---

## Mit csinál

| | |
|---|---|
| **Teljes telepítés** | Java 21 (Temurin), Minecraft 1.21.11, Fabric Loader, könyvtárak, assetek, natives — mind automatikusan, SHA-1 ellenőrzéssel |
| **Mod-szinkron** | A `resources/bestclient-pack.json`-ban leírt modok a Modrinth API-ról, mindig a legfrissebb 1.21.11-es Fabric buildben |
| **Rögzített szerver** | `bestpvp.eu` a lista első helyén, minden indítás előtt visszaállítva; `bestpvp.hu` egyszer beszúrva (ez törölhető) |
| **PvP beállítások** | `options.txt` alapérték: vsync ki, view bobbing ki, minimál partikulák, entity shadow ki, fast graphics, 0 screen/FOV effekt |
| **GC-hangolás** | G1GC 50 ms pause target, `AlwaysPreTouch`, `ParallelRefProcEnabled` — a cél a lapos frame time, nem a nyers throughput |
| **Bejelentkezés** | Microsoft device-code OAuth → Xbox Live → XSTS → Minecraft; a token a `launcher.json`-ban marad, a rendererhez soha nem jut el |

---

## Fejlesztés

```bash
npm install
```

```bash
npm run dev
```

A `dev` script párhuzamosan indítja a Next.js dev szervert (`127.0.0.1:4571`) és az Electront.

> A preload script **külön bundle-t** kap (`build:preload`, esbuild). Ez nem opcionális: a sandboxolt preload nem tud relatív modult `require`-elni, ezért egyetlen self-contained fájlnak kell lennie. A `tsc` kimenetét szándékosan felülírja.

Típusellenőrzés a renderer és a main process felett:

```bash
npm run typecheck
```

Telepítő build (NSIS, Windows x64):

```bash
npm run dist
```

---

## Microsoft bejelentkezés beállítása

A repóban **szándékosan nincs Azure client ID**. Minden launchernek sajátot kell regisztrálnia:

1. [Azure Portal](https://portal.azure.com) → *App registrations* → *New registration*
2. *Supported account types*: **Personal Microsoft accounts only**
3. *Authentication* → *Advanced settings* → **Allow public client flows: Yes**
4. Másold ki az *Application (client) ID*-t

Ezután add meg az egyiket:

```bash
set BESTCLIENT_MS_CLIENT_ID=a-te-client-idd
```

vagy hozz létre egy `launcher/resources/auth.json` fájlt:

```json
{ "clientId": "a-te-client-idd" }
```

> A Minecraft API éles használatához a Mojang jóváhagyása is kell — enélkül a `login_with_xbox` hívás 403-at adhat.

---

## Könyvtárszerkezet

```
BestClient/
├─ launcher/
│  ├─ electron/            # main process (TypeScript → dist-electron/)
│  │  ├─ main.ts           # ablak, app:// protokoll, biztonsági korlátok
│  │  ├─ preload.ts        # contextBridge API
│  │  ├─ ipc.ts            # IPC handlerek
│  │  ├─ shared.ts         # IPC szerződés
│  │  └─ core/
│  │     ├─ auth.ts        # Microsoft device-code flow
│  │     ├─ brand.ts       # márkaszínek, rögzített szerver, célverziók
│  │     ├─ fabric.ts      # Fabric meta
│  │     ├─ install.ts     # a teljes telepítési folyamat
│  │     ├─ java.ts        # Java 21 keresés / Temurin letöltés
│  │     ├─ launch.ts      # JVM argumentumok, folyamatindítás
│  │     ├─ modpack.ts     # Modrinth feloldás és mods/ szinkron
│  │     ├─ nbt.ts         # minimális NBT író/olvasó
│  │     ├─ net.ts         # letöltés SHA-1 ellenőrzéssel, retry
│  │     ├─ options.ts     # options.txt PvP alapértékek
│  │     ├─ servers.ts     # servers.dat + rögzített bejegyzés
│  │     └─ store.ts       # launcher.json
│  ├─ src/                 # Next.js renderer (App Router)
│  └─ resources/
│     └─ bestclient-pack.json
└─ package.json            # npm workspace
```

Futásidejű adatok: `%APPDATA%\.bestclient\`
A játék könyvtára (mods, config, saves): `%APPDATA%\.bestclient\instance\`

---

## Márka

| | |
|---|---|
| Soft accent | `#ffb8e0` |
| Strong accent | `#ff75c3` |

A színek egy helyen élnek: `launcher/electron/core/brand.ts` és `launcher/src/app/globals.css`.

---

## Ismert korlátok

- **A rögzített szerver launcher-szintű.** A `bestpvp.eu` bejegyzést minden indítás előtt visszaírjuk, de futó játék közben a játékos ki tudja törölni — a következő indításig. A valódi, játékon belüli zároláshoz Fabric mixin kell (`ServerList#remove` és a `MultiplayerScreen` Delete/Edit gombjai).
- **Nincs logó.** Az ikon helye elő van készítve: `launcher/build/icon.ico`, az `electron-builder.yml`-ben a sor kikommentelve várja.
- **Csak Windows x64.** A Java-keresés és a natives-kezelés jelenleg Windows-specifikus.
- **Kockázatos modok.** A `betterhitreg` és a `knockbacksync` alapból **ki van kapcsolva** — sok PvP szerver tiltja őket. Bekapcsolásuk a játékos felelőssége.

---

## Licenc

Minden jog fenntartva — lásd [LICENSE](LICENSE).
A Minecraft a Mojang AB / Microsoft védjegye. A BestClient nem áll kapcsolatban velük.
