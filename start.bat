@echo off
setlocal
title BestClient
pushd "%~dp0"

REM A konzolszovegek szandekosan ekezet nelkuliek: a cmd.exe kodlapja gepenkent
REM elter, es a chcp 65001 sem megbizhato minden Windowson. A launcher sajat
REM felulete termeszetesen ekezetes.

echo.
echo   BestClient - Minecraft 1.21.11 / Fabric
echo   =======================================
echo.

where node >nul 2>&1
if errorlevel 1 goto nonode

if not exist "node_modules\" goto install
goto checkbuild

:install
echo   Fuggosegek telepitese - az elso alkalommal ez par percig tart...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
echo.

:checkbuild
if not exist "launcher\dist-electron\main.js" goto build
if not exist "launcher\dist-electron\preload.js" goto build
if not exist "launcher\out\index.html" goto build
goto run

:build
echo   Build...
echo.
call npm run build
if errorlevel 1 goto fail
echo.

:run
echo   Inditas...
echo.
call npm start
if errorlevel 1 goto fail
popd
exit /b 0

:nonode
echo   [HIBA] Nincs telepitve a Node.js.
echo   Toltsd le innen: https://nodejs.org  (LTS verzio)
goto fail

:fail
echo.
echo   =======================================
echo   A BestClient nem indult el.
echo   A fenti uzenet mondja meg, hogy miert.
echo.
popd
pause
exit /b 1
