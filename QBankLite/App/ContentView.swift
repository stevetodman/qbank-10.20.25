import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebViewContainer()
    }
}

struct WebViewContainer: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.javaScriptCanAccessClipboard = true
        let userContent = configuration.userContentController
        let bootstrapScript = """
        window.qbBridge = window.qbBridge || {};
        window.qbBridge.pending = window.qbBridge.pending || {};
        window.qbBridge.onNativeMessage = window.qbBridge.onNativeMessage || function(msg) {
            console.log('Bridge message received before js loads', msg);
        };
        """
        let script = WKUserScript(source: bootstrapScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        userContent.addUserScript(script)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.configure(with: webView)

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Resources") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
    }

    final class Coordinator: NSObject {
        private var bridge: WebViewBridge?
        private var schemeHandler: QBURLSchemeHandler?

        func configure(with webView: WKWebView) {
            schemeHandler = QBURLSchemeHandler()
            if let handler = schemeHandler {
                webView.configuration.setURLSchemeHandler(handler, forURLScheme: "qb")
            }
            bridge = WebViewBridge(webView: webView)
            webView.configuration.userContentController.add(bridge!, name: "qbBridge")
        }

        deinit {
            if let bridge = bridge {
                bridge.invalidate()
            }
        }
    }
}
