@echo off
rem Burner launcher for Windows: starts the bridge and opens the browser.
rem Extra arguments pass through, e.g.  burner.cmd --port 9000
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 burner_bridge.py --open %*
  goto done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python burner_bridge.py --open %*
  goto done
)
echo Python 3 was not found.
echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH",
echo then run burner.cmd again. No other installs are needed.
:done
pause
