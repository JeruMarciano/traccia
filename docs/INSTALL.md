# Installing Traccia

Traccia is free and unsigned. Because it is unsigned, both operating systems will warn you the first
time you open it. Here is exactly what you will see and why.

## macOS

1. Open the `.dmg` and drag Traccia to Applications.
2. The first launch shows "Traccia cannot be opened because the developer cannot be verified."
3. Right-click the app, choose **Open**, then **Open** again in the dialog.
4. This is needed once.

## Windows

1. Run the `.exe`.
2. SmartScreen shows "Windows protected your PC."
3. Click **More info**, then **Run anyway**.

## Why the warnings

Signing an application requires paid certificates from Apple and a certificate authority. Traccia is
free and not signed yet. The warnings mean the operating system cannot confirm who published the app,
not that anything is wrong with it. Download only from the project's GitHub releases page.

## What Traccia sends over the network

Nothing, except when you explicitly scan a website address you have typed in. There is no telemetry,
no crash reporting, no update check, and no account. If the app hits an unexpected error it writes a
short line to a local log file and nothing else. You can find that log at:

- macOS: `~/Library/Application Support/Traccia/traccia.log`
- Windows: `%APPDATA%\Traccia\traccia.log`
