import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

final class WebViewBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var timer: Timer?
    private let queue = DispatchQueue(label: "com.qbanklite.bridge")

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        scheduleSnapshotTimer()
    }

    func invalidate() {
        timer?.invalidate()
        timer = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "qbBridge")
    }

    private func scheduleSnapshotTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            guard DirectoryHelper.autoSnapshotEnabled else { return }
            self?.queue.async {
                do {
                    let result = try DirectoryHelper.snapshotNow()
                    self?.sendSuccess(id: nil, payload: ["type": "autosnapshot", "files": result])
                } catch {
                    self?.sendError(id: nil, message: "Auto-snapshot failed: \(error.localizedDescription)")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "qbBridge" else { return }
        queue.async {
            self.handleMessage(message.body)
        }
    }

    private func handleMessage(_ body: Any) {
        guard let dict = body as? [String: Any],
              let id = dict["id"] as? String,
              let action = dict["action"] as? String else {
            sendError(id: nil, message: "Invalid bridge message")
            return
        }
        let payload = dict["payload"] as? [String: Any] ?? [:]
        do {
            switch action {
            case "ensureDataDirs":
                let info = DirectoryHelper.bootstrapIfNeeded()
                sendSuccess(id: id, payload: info)
            case "readTextFile":
                guard let path = payload["path"] as? String else { throw BridgeError.missingField("path") }
                let text = try DirectoryHelper.readTextFile(named: path)
                sendSuccess(id: id, payload: ["content": text])
            case "writeTextFile":
                guard let path = payload["path"] as? String,
                      let content = payload["content"] as? String else { throw BridgeError.missingField("path/content") }
                try DirectoryHelper.writeTextFile(named: path, content: content)
                sendSuccess(id: id, payload: ["ok": true])
            case "appendHistory":
                guard let record = payload["record"] else { throw BridgeError.missingField("record") }
                try DirectoryHelper.appendHistory(record: record)
                sendSuccess(id: id, payload: ["ok": true])
            case "listMedia":
                guard let kind = payload["kind"] as? String else { throw BridgeError.missingField("kind") }
                let files = try DirectoryHelper.listMedia(kind: kind)
                sendSuccess(id: id, payload: ["files": files])
            case "copyIntoMedia":
                guard let kind = payload["kind"] as? String else { throw BridgeError.missingField("kind") }
                DispatchQueue.main.async {
                    self.presentCopyPanel(id: id, kind: kind)
                }
            case "exportFile":
                guard let suggestedName = payload["suggestedName"] as? String,
                      let content = payload["content"] as? String else { throw BridgeError.missingField("suggestedName/content") }
                DispatchQueue.main.async {
                    self.presentExportPanel(id: id, suggestedName: suggestedName, content: content)
                }
            case "importFile":
                let accepts = payload["accept"] as? [String]
                DispatchQueue.main.async {
                    self.presentImportPanel(id: id, allowed: accepts)
                }
            case "snapshotNow":
                let files = try DirectoryHelper.snapshotNow()
                sendSuccess(id: id, payload: ["files": files])
            case "getAppInfo":
                let info = DirectoryHelper.appInfo()
                sendSuccess(id: id, payload: info)
            case "setAutoSnapshots":
                guard let enabled = payload["enabled"] as? Bool else { throw BridgeError.missingField("enabled") }
                DirectoryHelper.autoSnapshotEnabled = enabled
                sendSuccess(id: id, payload: ["ok": true])
            default:
                throw BridgeError.unknownAction(action)
            }
        } catch {
            sendError(id: id, message: error.localizedDescription)
        }
    }

    private func presentCopyPanel(id: String, kind: String) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        if #available(macOS 11.0, *) {
            panel.allowedContentTypes = kind == "images" ? [.image] : [.audio]
        }
        panel.begin { response in
            if response == .OK {
                do {
                    let urls = try DirectoryHelper.copyIntoMedia(kind: kind, urls: panel.urls)
                    self.sendSuccess(id: id, payload: ["files": urls])
                } catch {
                    self.sendError(id: id, message: error.localizedDescription)
                }
            } else {
                self.sendError(id: id, message: "cancelled")
            }
        }
    }

    private func presentExportPanel(id: String, suggestedName: String, content: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        panel.begin { response in
            if response == .OK, let url = panel.url {
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    self.sendSuccess(id: id, payload: ["path": url.path])
                } catch {
                    self.sendError(id: id, message: error.localizedDescription)
                }
            } else {
                self.sendError(id: id, message: "cancelled")
            }
        }
    }

    private func presentImportPanel(id: String, allowed: [String]?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if let allowed = allowed, !allowed.isEmpty {
            panel.allowedFileTypes = allowed.map { $0.replacingOccurrences(of: ".", with: "") }
        }
        panel.begin { response in
            if response == .OK, let url = panel.url {
                do {
                    let content = try String(contentsOf: url)
                    self.sendSuccess(id: id, payload: ["content": content, "filename": url.lastPathComponent])
                } catch {
                    self.sendError(id: id, message: error.localizedDescription)
                }
            } else {
                self.sendError(id: id, message: "cancelled")
            }
        }
    }

    private func sendSuccess(id: String?, payload: [String: Any]) {
        var message: [String: Any] = ["success": true, "payload": payload]
        if let id = id {
            message["id"] = id
        }
        send(message)
    }

    private func sendError(id: String?, message: String) {
        var payload: [String: Any] = ["success": false, "error": message]
        if let id = id {
            payload["id"] = id
        }
        send(payload)
    }

    private func send(_ dictionary: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript("window.qbBridge && window.qbBridge.onNativeMessage && window.qbBridge.onNativeMessage(\(json));", completionHandler: nil)
        }
    }

    enum BridgeError: LocalizedError {
        case missingField(String)
        case unknownAction(String)

        var errorDescription: String? {
            switch self {
            case .missingField(let name):
                return "Missing field: \(name)"
            case .unknownAction(let action):
                return "Unknown action: \(action)"
            }
        }
    }
}
