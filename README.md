# BestClient

A Minecraft PvP client for [bestpvp.eu](https://bestpvp.eu) — a launcher and an in-game
mod that install, verify and update themselves.

## Download

**[Get the latest installer](https://github.com/ArteffCods/BestClient/releases)** — pick the
newest release and download `BestClient-Setup-<version>.exe`. Windows only, 64-bit.

Once installed, the client keeps itself up to date: it checks this repository every fifteen
minutes, downloads a new build in the background, and puts an **Update** button in the title
bar. Nothing is installed until you press it.

## What it does

- **Installs the whole client**, not just the game: Java, Minecraft, Fabric, the mod set,
  the server entry and a PvP options baseline. Minecraft 1.21.11, 26.1.2 and 26.2.
- **Reads every mod against every other one** before the game starts. Two mods that cannot
  load together are the usual cause of a client that closes on startup; the launcher finds
  them first and holds one a build back rather than letting the game fail.
- **Only installs what Modrinth publishes.** Every jar is checked against its published
  hash, and anything the launcher does not recognise blocks the launch.
- **Its own in-game half**, opened with Right Shift: FPS, CPS, coordinates, ping, a
  keystroke overlay and fullbright, each one placeable anywhere on the screen.

## What is in this repository

This repository is the client's update channel, not its source.

| File | What it is |
| --- | --- |
| `version.json` | The current release: version, tag, installer name and its SHA-256. This is the file the launcher polls. |
| `changelog.json` | Every release, newest first. The launcher shows it in the changelog rail. |
| `news.json` | The cards on the Play screen. |
| `news/` | Artwork for those cards. |

Releases carry the installer itself.

## Reporting something

Open an [issue](https://github.com/ArteffCods/BestClient/issues), or say so in the
[Discord](https://discord.gg/HGxU2nAEts).

---

© 2026 BestClient. All rights reserved.
