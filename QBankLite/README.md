# QBankLite

QBankLite is a tiny macOS SwiftUI app that wraps a local HTML/JavaScript interface for managing a question bank completely offline. The app persists data under `~/Documents/QBank/` and exposes file operations to the embedded UI through a custom bridge.

## Features

- SwiftUI shell with a single `WKWebView` loading bundled assets.
- Automatic creation of the data folder with sample content on first launch.
- JS bridge actions for reading/writing JSON, importing/exporting, managing media, and triggering snapshots.
- Custom `qb://` URL scheme that securely exposes media files stored in the Documents folder.
- Practice and exam modes with keyboard shortcuts and full history tracking.
- Import/export flows for JSON and CSV question banks.
- Periodic (10 minute) and on-demand snapshots of `items.json` and `history.json`.

## Building the App

1. Open `QBankLite.xcodeproj` in Xcode 15 or newer.
2. Select the **QBankLite** target. Under **Signing & Capabilities**, ensure the App Sandbox capability is disabled to allow writes to `~/Documents/QBank/`.
3. Build and run. On first launch the app creates the required folders and seeds the bank with five sample questions plus placeholder media files.

## Runtime Notes

- All file I/O is handled via `DirectoryHelper` and bridged to JavaScript through `WebViewBridge`.
- Media references are exposed via the `qb://` URL scheme, served by `QBURLSchemeHandler`.
- The embedded UI lives in `Resources/index.html`, `styles.css`, and `app.js` and communicates with Swift using structured JSON messages.
- Snapshots are written to `~/Documents/QBank/snapshots/` automatically every ten minutes (configurable via the Settings view) and whenever a session ends.

## Testing the UI

Because the UI is pure HTML/JS loaded inside `WKWebView`, you can iterate on the resources by rebuilding the project. No external dependencies or package managers are required.
