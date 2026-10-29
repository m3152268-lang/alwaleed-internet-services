@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Alwaleed Supabase Setup

echo ================================================
echo   Alwaleed - Deploy Supabase Edge Functions
echo ================================================
echo.
echo This script deploys the existing functions to your Supabase project.
echo It does NOT change or delete client/payment rows.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed. Install the LTS version from https://nodejs.org then reopen this file.
  pause
  exit /b 1
)

echo Step 1/4: Sign in to Supabase CLI. A browser may open.
call npx --yes supabase login
if errorlevel 1 goto failed

echo.
echo Step 2/4: Link this folder to the known project.
call npx --yes supabase link --project-ref mecjmsuiilirgljnwhoq
if errorlevel 1 goto failed

echo.
echo Step 3/4: Add the server-only service role secret.
echo Get it from Supabase Dashboard - Project Settings - API (service_role / secret key).
echo NEVER paste it into ChatGPT or put it in index.html/config.js.
echo The key will be stored briefly in a local temporary file and deleted after upload.
set "SERVICE_KEY="
set /p "SERVICE_KEY=Paste the service_role/secret key here, then press Enter: "
if "%SERVICE_KEY%"=="" (
  echo ERROR: No key was entered.
  goto failed
)
>".env.functions.tmp" echo ALWALEED_SERVICE_ROLE_KEY=%SERVICE_KEY%
set "SERVICE_KEY="
call npx --yes supabase secrets set --env-file .env.functions.tmp
set "SECRET_RESULT=%ERRORLEVEL%"
del /q ".env.functions.tmp" >nul 2>nul
if not "%SECRET_RESULT%"=="0" goto failed

echo.
echo Step 4/4: Deploying both functions...
call npx --yes supabase functions deploy approve-login
if errorlevel 1 goto failed
call npx --yes supabase functions deploy admin-users
if errorlevel 1 goto failed

echo.
echo SUCCESS: Both Edge Functions were deployed.
echo Next, test login and user approval in your app.
echo If the app reports an error, copy only the error message - never share secret keys.
pause
exit /b 0

:failed
echo.
echo SETUP DID NOT FINISH. Read the error above, fix it, then run this file again.
if exist ".env.functions.tmp" del /q ".env.functions.tmp" >nul 2>nul
pause
exit /b 1
