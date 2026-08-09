# Releasing a build

The launcher updates itself from two files in this repository and one GitHub release.
Publish them in the order below — a `version.json` that names a release which does not
exist yet sends every installed client into a failed download.

## 1. Build the installer

```
cd launcher
npm run dist
```

The installer lands in `launcher/release/BestClient-Setup-<version>.exe`. The file name is
fixed by `electron-builder.yml` and must match `asset` in `version.json`.

Both `package.json` files carry the version. Bump them together before building.

## 2. Publish the GitHub release

Create a release tagged `v<version>` and attach the installer to it. The tag has to match
`tag` in `version.json`.

```
gh release create v0.2.0 launcher/release/BestClient-Setup-0.2.0.exe --title "BestClient 0.2.0" --notes-file changelog-body.md
```

## 3. Update `version.json`

Only now, and only on `main`:

```json
{
  "version": "0.2.0",
  "notes": "One line, shown next to the Update button.",
  "tag": "v0.2.0",
  "asset": "BestClient-Setup-0.2.0.exe",
  "sha256": "<sha256 of the installer>"
}
```

Get the checksum with:

```
certutil -hashfile launcher\release\BestClient-Setup-0.2.0.exe SHA256
```

`sha256` is optional in the sense that the launcher runs without it, but leave it empty and
nothing verifies what was downloaded before it is executed. Always fill it in.

## 4. Update `changelog.json`

The right-hand rail in the launcher reads this file directly. Newest entry first.

```json
[
  {
    "version": "0.2.0",
    "date": "2026-08-09",
    "title": "Short headline",
    "description": "A sentence or two.",
    "changes": ["One line per change"]
  }
]
```

## What the launcher does with this

On start, and every 30 minutes after, it reads `version.json`. If the version there is newer
than the running one it downloads the installer in the background — the player is never
interrupted — and the title bar grows an **Update** button next to the version number.
Nothing is installed until that button is pressed. The download is checksummed, kept in
`%APPDATA%/.bestclient/updates`, and survives a restart, so a client that was closed
mid-download does not start over.

Pressing Update runs the installer with `/S --updated --force-run`: it replaces the
installation in place without a wizard, without a UAC prompt (the package installs
per-user), and starts the new build.

## Private repository

While the repository is public no configuration is needed. If it is made private, put a
fine-grained, read-only, single-repository token in `launcher/resources/update-token.json`
(see `update-token.example.json`) before building, or set `BESTCLIENT_UPDATE_TOKEN` in the
environment for a local run.

A token shipped inside a desktop application can be extracted by anyone who has the
application. Read-only and scoped to this one repository is what keeps that harmless; rotate
it if a build leaks.
