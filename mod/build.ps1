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

# Both ends of Gradle's internal socket pair need this, not just the daemon.
#
# Since JDK 17 a java.nio Selector on Windows is an AF_UNIX socket pair, and its socket
# file is created in the temp directory. Where that path is a short ("8.3") name -
# C:\Users\ARTEFF~1\AppData\Local\Temp - connect fails with EINVAL, and Gradle reports it
# as "Unable to establish loopback connection", which points at a firewall that was never
# involved. A plain path makes Selector.open() work and the build run.
#
# JAVA_TOOL_OPTIONS rather than GRADLE_OPTS: every JVM the build starts inherits it, and
# this build starts three - the launcher, the daemon it forks, and the workers the daemon
# forks. Setting it on one of those only moves the failure to the next one.
$tmp = (Join-Path $here '.gradle-tmp') -replace '\\', '/'
New-Item -ItemType Directory -Force $tmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$tmp"

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
