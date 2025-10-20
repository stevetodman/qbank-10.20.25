import CryptoKit
import Foundation

enum DirectoryError: LocalizedError {
    case invalidPath

    var errorDescription: String? {
        switch self {
        case .invalidPath:
            return "Invalid file path"
        }
    }
}

enum MediaKind: String {
    case images
    case audio
}

struct DirectoryHelper {
    private static let fileManager = FileManager.default
    private static let baseURLInternal: URL = {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("QBank", isDirectory: true)
    }()

    static var baseURL: URL { baseURLInternal }

    private static var itemsURL: URL { baseURL.appendingPathComponent("items.json") }
    private static var historyURL: URL { baseURL.appendingPathComponent("history.json") }
    private static var mediaImagesURL: URL { baseURL.appendingPathComponent("media/images", isDirectory: true) }
    private static var mediaAudioURL: URL { baseURL.appendingPathComponent("media/audio", isDirectory: true) }
    private static var snapshotsURL: URL { baseURL.appendingPathComponent("snapshots", isDirectory: true) }

    private static let historyQueue = DispatchQueue(label: "com.qbanklite.history", qos: .utility)
    private static let autoSnapshotKey = "com.qbanklite.autoSnapshots"

    static var autoSnapshotEnabled: Bool {
        get { UserDefaults.standard.object(forKey: autoSnapshotKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: autoSnapshotKey) }
    }

    @discardableResult
    static func bootstrapIfNeeded() -> [String: Any] {
        do {
            try ensureDirectories()
            try ensureSeedFiles()
        } catch {
            NSLog("Bootstrap error: \(error.localizedDescription)")
        }
        return appInfo()
    }

    static func appInfo() -> [String: Any] {
        [
            "dataPath": baseURL.path,
            "itemsPath": itemsURL.path,
            "historyPath": historyURL.path,
            "snapshotsPath": snapshotsURL.path,
            "autoSnapshots": autoSnapshotEnabled
        ]
    }

    private static func ensureDirectories() throws {
        let directories = [baseURL, mediaImagesURL, mediaAudioURL, snapshotsURL]
        for dir in directories {
            if !fileManager.fileExists(atPath: dir.path) {
                try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
            }
        }
    }

    private static func ensureSeedFiles() throws {
        if !fileManager.fileExists(atPath: historyURL.path) {
            try "[]".write(to: historyURL, atomically: true, encoding: .utf8)
        }
        if !fileManager.fileExists(atPath: itemsURL.path) {
            if let seedURL = Bundle.main.url(forResource: "items", withExtension: "json", subdirectory: "Seed"),
               let data = try? Data(contentsOf: seedURL) {
                try data.write(to: itemsURL)
            } else {
                try "[]".write(to: itemsURL, atomically: true, encoding: .utf8)
            }
        }
        let placeholderImage = mediaImagesURL.appendingPathComponent("sample_cxr.png")
        if !fileManager.fileExists(atPath: placeholderImage.path) {
            fileManager.createFile(atPath: placeholderImage.path, contents: Data())
        }
        let placeholderAudio = mediaAudioURL.appendingPathComponent("sample_murmur.mp3")
        if !fileManager.fileExists(atPath: placeholderAudio.path) {
            fileManager.createFile(atPath: placeholderAudio.path, contents: Data())
        }
    }

    static func readTextFile(named name: String) throws -> String {
        try ensureDirectories()
        let url = baseURL.appendingPathComponent(name)
        guard url.path.hasPrefix(baseURL.path) else { throw DirectoryError.invalidPath }
        return try String(contentsOf: url)
    }

    static func writeTextFile(named name: String, content: String) throws {
        try ensureDirectories()
        let url = baseURL.appendingPathComponent(name)
        guard url.path.hasPrefix(baseURL.path) else { throw DirectoryError.invalidPath }
        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    static func appendHistory(record: Any) throws {
        try ensureDirectories()
        try historyQueue.sync {
            let existingData = (try? Data(contentsOf: historyURL)) ?? Data("[]".utf8)
            var array = (try? JSONSerialization.jsonObject(with: existingData, options: [])) as? [Any] ?? []
            array.append(record)
            let output = try JSONSerialization.data(withJSONObject: array, options: [.prettyPrinted])
            try output.write(to: historyURL, options: .atomic)
        }
    }

    static func listMedia(kind: String) throws -> [String] {
        guard let mediaKind = MediaKind(rawValue: kind) else { throw DirectoryError.invalidPath }
        let url = mediaKind == .images ? mediaImagesURL : mediaAudioURL
        let contents = (try? fileManager.contentsOfDirectory(atPath: url.path)) ?? []
        return contents.sorted()
    }

    static func copyIntoMedia(kind: String, urls: [URL]) throws -> [String] {
        guard let mediaKind = MediaKind(rawValue: kind) else { throw DirectoryError.invalidPath }
        let destinationDir = mediaKind == .images ? mediaImagesURL : mediaAudioURL
        var results: [String] = []
        for source in urls {
            var destination = destinationDir.appendingPathComponent(source.lastPathComponent)
            if fileManager.fileExists(atPath: destination.path) {
                let base = destination.deletingPathExtension().lastPathComponent
                let ext = destination.pathExtension
                let suffix = String(UUID().uuidString.prefix(8))
                let uniqueName = base + "_" + suffix
                destination = destinationDir.appendingPathComponent(uniqueName + (ext.isEmpty ? "" : "." + ext))
            }
            if destination.path == source.path {
                results.append(destination.lastPathComponent)
            } else {
                try fileManager.copyItem(at: source, to: destination)
                results.append(destination.lastPathComponent)
            }
        }
        return results
    }

    @discardableResult
    static func snapshotNow() throws -> [String] {
        try ensureDirectories()
        var filenames: [String] = []
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let stamp = formatter.string(from: Date())
        let itemsSnapshot = snapshotsURL.appendingPathComponent("items_\(stamp).json")
        let historySnapshot = snapshotsURL.appendingPathComponent("history_\(stamp).json")
        if fileManager.fileExists(atPath: itemsURL.path) {
            try? fileManager.removeItem(at: itemsSnapshot)
            try fileManager.copyItem(at: itemsURL, to: itemsSnapshot)
            filenames.append(itemsSnapshot.lastPathComponent)
        }
        if fileManager.fileExists(atPath: historyURL.path) {
            try? fileManager.removeItem(at: historySnapshot)
            try fileManager.copyItem(at: historyURL, to: historySnapshot)
            filenames.append(historySnapshot.lastPathComponent)
        }
        return filenames
    }

    static func sha256OfItems() -> String {
        guard let data = try? Data(contentsOf: itemsURL) else { return "" }
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02hhx", $0) }.joined()
    }
}
