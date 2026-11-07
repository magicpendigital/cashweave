import Capacitor
import UIKit
import WebKit

final class CashWeaveViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // enabled:false disables HTTP patching, while explicit native requests
        // remain available in upstream Capacitor. Replace that bridge too.
        bridge?.registerPluginInstance(OfflineHttpPlugin())
        bridge?.registerPluginInstance(LocalBackupPlugin())
        webView?.allowsLinkPreview = false
        webView?.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { webView?.isInspectable = false }
        // A second layer beneath CSP: deny network resources, including future
        // accidental URLs, without changing the persistent local data store.
        let rules = #"[{"trigger":{"url-filter":"^(https?|wss?)://"},"action":{"type":"block"}}]"#
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "cashweave-offline-v1", encodedContentRuleList: rules) { [weak self] list, error in
            guard let self else { return }
            DispatchQueue.main.async {
                if let list, error == nil, let webView = self.webView as? CashWeaveOfflineWebView { webView.enableOfflineRules(list) }
                else {
                    self.webView?.stopLoading()
                    self.webView?.isHidden = true
                    let label = UILabel(frame: self.view.bounds)
                    label.numberOfLines = 0; label.textAlignment = .center
                    label.text = "Chưa bật được chế độ offline an toàn. Hãy mở lại ứng dụng; không xóa hoặc cài lại để giữ dữ liệu."
                    self.view = label
                }
            }
        }
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsInlineMediaPlayback = false
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        return configuration
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        CashWeaveOfflineWebView(frame: frame, configuration: configuration)
    }
}

// Hold the very first document until the native network blocklist is installed.
// Retain the default persistent WKWebsiteDataStore so upgrades keep IndexedDB.
private final class CashWeaveOfflineWebView: WKWebView {
    private var offlineRulesReady = false
    private var pendingRequest: URLRequest?
    override func load(_ request: URLRequest) -> WKNavigation? {
        guard let url = request.url, url.scheme == "capacitor", url.host == "localhost", url.port == nil,
              url.user == nil, url.password == nil else { return nil }
        guard offlineRulesReady else { pendingRequest = request; return nil }
        return super.load(request)
    }
    func enableOfflineRules(_ list: WKContentRuleList) {
        configuration.userContentController.add(list)
        offlineRulesReady = true
        if let request = pendingRequest { pendingRequest = nil; _ = load(request) }
    }
}

@objc(OfflineHttpPlugin)
final class OfflineHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "OfflineHttpPlugin"
    let jsName = "CapacitorHttp"
    let pluginMethods = ["request", "get", "post", "put", "patch", "delete"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    @objc func request(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
    @objc func get(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
    @objc func post(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
    @objc func put(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
    @objc func patch(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
    @objc func delete(_ call: CAPPluginCall) { call.reject("NETWORK_DISABLED_OFFLINE") }
}
