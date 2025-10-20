import SwiftUI

@main
struct QBankLiteApp: App {
    init() {
        DirectoryHelper.bootstrapIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 1024, minHeight: 700)
        }
    }
}
