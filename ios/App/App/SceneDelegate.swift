import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        if AppDelegate.storageProtectionReady { window?.rootViewController = CashWeaveViewController() }
        else {
            let controller = UIViewController()
            let label = UILabel()
            label.numberOfLines = 0; label.textAlignment = .center
            label.text = "Chưa bảo vệ được kho dữ liệu offline. Hãy mở lại ứng dụng; không xóa hoặc cài lại ứng dụng."
            controller.view = label
            window?.rootViewController = controller
        }
        window?.makeKeyAndVisible()

        // No URL/deep-link forwarding or remote application integrations.
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // External URLs never activate imports or mutate the local dataset.
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Handoff and universal links are intentionally unsupported offline.
    }
}
