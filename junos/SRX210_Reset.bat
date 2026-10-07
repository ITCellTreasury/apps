@echo off
setlocal EnableExtensions

title Juniper SRX210 Factory Default Reset

cls

echo.
echo ============================================================
echo             JUNIPER SRX210 FACTORY RESET
echo ============================================================
echo.
echo This procedure will:
echo.
echo   1. Connect to the SRX210 using Windows SSH
echo   2. Enter Junos CLI
echo   3. Enter configuration mode
echo   4. Load factory-default
echo   5. Set root authentication
echo   6. Ask you to manually enter the NEW root password
echo   7. Commit the configuration
echo.
echo ============================================================
echo                       WARNING
echo ============================================================
echo.
echo The existing configuration will be replaced.
echo.
echo BEFORE CONTINUING:
echo.
echo   - Laptop Wi-Fi must be OFF
echo   - Connect laptop directly to SRX210
echo   - Disconnect FatPipe
echo   - Disconnect production LAN
echo   - Disconnect ISP/WAN
echo.
echo ============================================================
echo.

if not exist "%~dp0reset_commands.txt" (
    echo ERROR:
    echo.
    echo reset_commands.txt was not found.
    echo.
    echo Expected:
    echo %~dp0reset_commands.txt
    echo.
    pause
    exit /b 1
)

where ssh.exe >nul 2>&1

if errorlevel 1 (
    echo ERROR:
    echo.
    echo Windows built-in ssh.exe was not found.
    echo.
    echo Check that OpenSSH Client is installed in Windows.
    echo.
    pause
    exit /b 1
)

set /p "SRX_IP=Enter SRX210 IP address: "

if "%SRX_IP%"=="" (
    echo.
    echo ERROR: No IP address entered.
    echo.
    pause
    exit /b 1
)

cls

echo.
echo ============================================================
echo                  CONNECTION TEST
echo ============================================================
echo.
echo Testing %SRX_IP% ...
echo.

ping -n 2 %SRX_IP%

if errorlevel 1 (
    echo.
    echo ============================================================
    echo ERROR: SRX210 is not reachable.
    echo ============================================================
    echo.
    echo Check:
    echo.
    echo   - Ethernet cable
    echo   - Laptop IP address
    echo   - SRX210 IP address
    echo   - Laptop Wi-Fi is OFF
    echo.
    pause
    exit /b 1
)

echo.
echo SRX210 is reachable.
echo.

echo ============================================================
echo                 PREPARING COMMANDS
echo ============================================================
echo.

rem Copy Junos commands to Windows clipboard
type "%~dp0reset_commands.txt" | clip

echo The Junos command sequence has been copied to the clipboard.
echo.
echo The sequence is:
echo.
type "%~dp0reset_commands.txt"

echo.
echo ============================================================
echo                    SSH LOGIN
echo ============================================================
echo.
echo SSH username: root
echo.
echo When prompted, enter the CURRENT root password.
echo.
echo After successful login you should see:
echo.
echo     root@%
echo.
echo ============================================================
echo.

pause

cls

echo.
echo ============================================================
echo                  SSH SESSION
echo ============================================================
echo.
echo After entering the current root password:
echo.
echo  1. You will see root@%%
echo  2. Paste the commands from the clipboard
echo     using CTRL+SHIFT+V
echo  3. Wait for:
echo
echo        New password:
echo
echo  4. Enter your NEW root password manually
echo  5. Retype the NEW root password
echo  6. After the command returns to:
echo
echo        [edit]
echo
echo     type:
echo
echo        commit
echo
echo  7. Wait for:
echo
echo        commit complete
echo
echo ============================================================
echo.
echo Connecting to %SRX_IP% ...
echo.

ssh -tt root@%SRX_IP%

echo.
echo ============================================================
echo                 SSH SESSION ENDED
echo ============================================================
echo.
echo If the configuration was committed successfully,
echo the SRX210 factory configuration has been applied.
echo.
pause

endlocal
exit /b 0