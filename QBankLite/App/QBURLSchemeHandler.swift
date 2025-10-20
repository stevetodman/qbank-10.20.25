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
        let tailComponents = Array(pathComponents.dropFirst(2))
        guard !tailComponents.isEmpty else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        let base = DirectoryHelper.baseURL
        let directory: URL
        switch kind {
        case "images":
            directory = base.appendingPathComponent("media/images", isDirectory: true)
        case "audio":
            directory = base.appendingPathComponent("media/audio", isDirectory: true)
        default:
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        let resolvedDirectory = directory.resolvingSymlinksInPath()
        var fileURL = resolvedDirectory
        for component in tailComponents {
            fileURL = fileURL.appendingPathComponent(component)
        }
        fileURL = fileURL.resolvingSymlinksInPath()
        let baseComponents = resolvedDirectory.pathComponents
        let fileComponents = fileURL.pathComponents
        guard fileComponents.starts(with: baseComponents) else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
            return
        }
        do {
            let data = try Data(contentsOf: fileURL)
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": mimeType(for: fileURL)]
            ) else {
                urlSchemeTask.didFailWithError(DirectoryError.invalidPath)
                return
            }
            urlSchemeTask.didReceive(response)
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
