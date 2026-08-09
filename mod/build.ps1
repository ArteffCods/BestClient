# Builds the BestClient Fabric mod without needing Gradle installed.
#
# The usual `gradlew` wrapper cannot be generated here, so this script fetches Gradle
# itself into mod/.gradle-dist (git-ignored) and runs the build with it.
#
#   powershell -ExecutionPolicy Bypass -File mod\build.ps1
#
# The finished jar lands in mod\build\libs\. Afterwards run, from the repo root:
#
#   node scripts\stamp-bundled-mods.mjs
#
# which copies it into the launcher and stamps its SHA-1, so the launcher will install
# and verify it on every launch.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# fabric-loom 1.17.x is built against Gradle 9.5 - a lower version fails with a
# "No matching variant ... org.gradle.plugin.api-version" error during configuration.
$gradleVersion = '9.5.0'
$distRoot = Join-Path $here '.gradle-dist'
$gradleHome = Join-Path $distRoot "gradle-$gradleVersion"
$gradleBat = Join-Path $gradleHome 'bin\gradle.bat'

# Fabric for Minecraft 1.21.x needs a JDK 21. Pick one up automatically if JAVA_HOME
# points somewhere older. (java -version writes to stderr, which `2>&1` would turn into a
# terminating error under ErrorActionPreference Stop, so it runs through cmd /c.)
function Find-Jdk21 {
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        $java = Join-Path $env:JAVA_HOME 'bin\java.exe'
        $out = cmd /c "`"$java`" -version 2>&1"
        if ($out -match 'version "21') { return $env:JAVA_HOME }
    }

    foreach ($base in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft")) {
        if (-not (Test-Path $base)) { continue }
        $found = Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'jdk-?21' } |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }

    return $null
}

$jdk = Find-Jdk21
if (-not $jdk) {
    Write-Error "No JDK 21 found. Install Temurin 21 from https://adoptium.net and run this again."
}

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
Write-Host "Using JDK: $jdk"

if (-not (Test-Path $gradleBat)) {
    Write-Host "Downloading Gradle $gradleVersion ..."
    New-Item -ItemType Directory -Force $distRoot | Out-Null
    $zip = Join-Path $distRoot 'gradle.zip'
    Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $distRoot -Force
    Remove-Item $zip
}

Set-Location $here

# The client JVM has to prefer IPv4 as well, not just the daemon: both ends of Gradle's
# internal socket pair need to agree, or a machine with a VPN/TAP adapter installed fails
# with "Unable to establish loopback connection" before the build even starts.
$env:GRADLE_OPTS = '-Djava.net.preferIPv4Stack=true'

& $gradleBat build --no-daemon

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "If the failure reads 'Unable to establish loopback connection', a network"
    Write-Host "filter driver is blocking Gradle's internal socket pair. Twingate and Npcap"
    Write-Host "are the usual causes - pause Twingate, then run this script again."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Built:"
Get-ChildItem (Join-Path $here 'build\libs') -Filter *.jar | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host ""
Write-Host "Next: node scripts\stamp-bundled-mods.mjs   (from the repo root)"
