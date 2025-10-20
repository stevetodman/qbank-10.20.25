import Foundation
import UniformTypeIdentifiers
import WebKit

final class QBURLSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        let pathComponents = url.pathComponents.filter { $0 != "/" }
        guard pathComponents.count >= 3, pathComponents[0] == "media" else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        let kind = pathComponents[1]
        let filename = pathComponents.dropFirst(2).joined(separator: "/")
        let base = DirectoryHelper.baseURL
        let directory: URL
        switch kind {
        case "images":
            directory = base.appendingPathComponent("media/images")
        case "audio":
            directory = base.appendingPathComponent("media/audio")
        default:
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        let resolvedDirectory = directory.resolvingSymlinksInPath()
        let candidateURL = resolvedDirectory.appendingPathComponent(filename)
        let resolvedFileURL = candidateURL.resolvingSymlinksInPath()
        let directoryPath = resolvedDirectory.path
        let requiredPrefix = directoryPath.hasSuffix("/") ? directoryPath : directoryPath + "/"
        guard resolvedFileURL.path.hasPrefix(requiredPrefix) else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        guard FileManager.default.fileExists(atPath: resolvedFileURL.path) else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        do {
            let data = try Data(contentsOf: resolvedFileURL)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": mimeType(for: resolvedFileURL)])
            urlSchemeTask.didReceive(response!)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // nothing to cancel
    }

    private func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension) {
            return type.preferredMIMEType ?? "application/octet-stream"
        }
        return "application/octet-stream"
    }
}
