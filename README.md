# CHD Q-Bank

CHD Q-Bank is an offline study companion for the Certified Health Data (CHD) exam. The repository packages a browser-based
question bank alongside a lightweight macOS wrapper application so learners can review material without relying on a network
connection.

## Repository Layout

- `CHD-QBank.html` – standalone HTML experience that runs in any modern browser.
- `Run CHD Q-Bank.command` – macOS helper script that launches the HTML quiz in the default browser.
- `QBankLite/` – SwiftUI project for the optional native macOS shell around the quiz (see [`QBankLite/README.md`](QBankLite/README.md)).
- `QBankLite.xcodeproj` – Xcode project file for building the macOS app.
- `README-mac.md` – end-user instructions tailored for macOS recipients.

## Quick Start

### Use the HTML quiz
1. Open `CHD-QBank.html` directly in your favorite browser.
2. Your progress is stored in the browser’s local storage, so the quiz works entirely offline.

### macOS one-click launcher
1. Double-click `Run CHD Q-Bank.command`.
2. If macOS warns that the file was downloaded from the internet, right-click the script, choose **Open**, then confirm **Open**.
3. The script opens `CHD-QBank.html` in your default browser.

## Building the macOS App

A native wrapper app is included for macOS users who prefer an application bundle.

1. Open `QBankLite.xcodeproj` in Xcode 15 or later.
2. Select the **QBankLite** target and disable the App Sandbox capability so the app can read/write under `~/Documents/QBank/`.
3. Build and run on macOS. On first launch the app seeds the Documents folder with sample data and media files.

For more detail on the app architecture and JavaScript bridge, consult [`QBankLite/README.md`](QBankLite/README.md).

## Updating Questions

To refresh the study content, replace `CHD-QBank.html` with a newer export. The launcher script and macOS wrapper continue to
work as-is.

## Distributing to Learners

- Zip the repository contents (or use the provided archive) and share it directly.
- macOS recipients can follow the steps in [`README-mac.md`](README-mac.md) for the smoothest setup.
- Other platforms can open the HTML quiz without additional tooling.

## License

This repository does not currently declare a license. If you intend to distribute the materials publicly, add an explicit license
file or contact the maintainers for guidance.
