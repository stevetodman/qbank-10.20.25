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
    private static let autoSnapshotIntervalKey = "com.qbanklite.autoSnapshotInterval"
    private static let minimumSnapshotInterval: TimeInterval = 60
    private static let maximumSnapshotInterval: TimeInterval = 60 * 60 * 24
    private static let defaultSnapshotInterval: TimeInterval = 600

    static var autoSnapshotEnabled: Bool {
        get { UserDefaults.standard.object(forKey: autoSnapshotKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: autoSnapshotKey) }
    }

    static var autoSnapshotInterval: TimeInterval {
        get {
            let stored = UserDefaults.standard.double(forKey: autoSnapshotIntervalKey)
            if stored >= minimumSnapshotInterval { return min(stored, maximumSnapshotInterval) }
            return defaultSnapshotInterval
        }
        set {
            let clamped = max(minimumSnapshotInterval, min(newValue, maximumSnapshotInterval))
            UserDefaults.standard.set(clamped, forKey: autoSnapshotIntervalKey)
        }
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
            "autoSnapshots": autoSnapshotEnabled,
            "autoSnapshotInterval": autoSnapshotInterval
        ]
    }

    private static func validatedURL(_ url: URL) throws -> URL {
        let resolvedBase = baseURL.standardizedFileURL.resolvingSymlinksInPath()
        let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
        guard isDescendant(resolved, of: resolvedBase) else { throw DirectoryError.invalidPath }
        return resolved
    }

    private static func validatedURL(named name: String) throws -> URL {
        let candidate = baseURL.appendingPathComponent(name)
        return try validatedURL(candidate)
    }

    private static func isDescendant(_ candidate: URL, of base: URL) -> Bool {
        let candidateComponents = candidate.pathComponents
        let baseComponents = base.pathComponents
        guard candidateComponents.count >= baseComponents.count else { return false }
        for (baseComponent, candidateComponent) in zip(baseComponents, candidateComponents) {
            if baseComponent != candidateComponent { return false }
        }
        return true
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
        let url = try validatedURL(named: name)
        return try String(contentsOf: url)
    }

    static func writeTextFile(named name: String, content: String) throws {
        try ensureDirectories()
        let url = try validatedURL(named: name)
        try content.write(to: url, atomically: true, encoding: .utf8)
    }

    static func appendHistory(record: Any) throws {
        try ensureDirectories()
        let historyFile = try validatedURL(historyURL)
        try historyQueue.sync {
            let existingData = (try? Data(contentsOf: historyFile)) ?? Data("[]".utf8)
            var array = (try? JSONSerialization.jsonObject(with: existingData, options: [])) as? [Any] ?? []
            array.append(record)
            let output = try JSONSerialization.data(withJSONObject: array, options: [.prettyPrinted])
            try output.write(to: historyFile, options: .atomic)
        }
    }

    static func listMedia(kind: String) throws -> [String] {
        guard let mediaKind = MediaKind(rawValue: kind) else { throw DirectoryError.invalidPath }
        let url = try validatedURL(mediaKind == .images ? mediaImagesURL : mediaAudioURL)
        let contents = (try? fileManager.contentsOfDirectory(atPath: url.path)) ?? []
        return contents.sorted()
    }

    static func copyIntoMedia(kind: String, urls: [URL]) throws -> [String] {
        guard let mediaKind = MediaKind(rawValue: kind) else { throw DirectoryError.invalidPath }
        let destinationDir = try validatedURL(mediaKind == .images ? mediaImagesURL : mediaAudioURL)
        var results: [String] = []
        for source in urls {
            var destination = destinationDir.appendingPathComponent(source.lastPathComponent)
            destination = try validatedURL(destination)
            if fileManager.fileExists(atPath: destination.path) {
                let base = destination.deletingPathExtension().lastPathComponent
                let ext = destination.pathExtension
                let suffix = String(UUID().uuidString.prefix(8))
                let uniqueName = base + "_" + suffix
                destination = destinationDir.appendingPathComponent(uniqueName + (ext.isEmpty ? "" : "." + ext))
                destination = try validatedURL(destination)
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
        let itemsFile = try validatedURL(itemsURL)
        let historyFile = try validatedURL(historyURL)
        let snapshotsDir = try validatedURL(snapshotsURL)
        let itemsSnapshot = snapshotsDir.appendingPathComponent("items_\(stamp).json")
        let historySnapshot = snapshotsDir.appendingPathComponent("history_\(stamp).json")
        if fileManager.fileExists(atPath: itemsFile.path) {
            try? fileManager.removeItem(at: itemsSnapshot)
            try fileManager.copyItem(at: itemsFile, to: itemsSnapshot)
            filenames.append(itemsSnapshot.lastPathComponent)
        }
        if fileManager.fileExists(atPath: historyFile.path) {
            try? fileManager.removeItem(at: historySnapshot)
            try fileManager.copyItem(at: historyFile, to: historySnapshot)
            filenames.append(historySnapshot.lastPathComponent)
        }
        return filenames
    }

    static func sha256OfItems() -> String {
        guard let itemsFile = try? validatedURL(itemsURL),
              let data = try? Data(contentsOf: itemsFile) else { return "" }
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02hhx", $0) }.joined()
    }
}
