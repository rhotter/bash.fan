import UIKit
import SwiftUI
import UserNotifications
import UserNotificationsUI

final class GoalNotificationController: UIViewController, UNNotificationContentExtension {
    private var host: UIHostingController<GoalAlertCard>?
    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        let info = content.userInfo
        let card = GoalAlertCard(title: content.title,
            score: info["scoreLine"] as? String ?? content.body,
            scorer: info["scorerLine"] as? String ?? "",
            assists: info["assistLine"] as? String ?? "",
            slug: info["teamSlug"] as? String ?? "")
        if let host { host.rootView = card }
        else {
            let controller = UIHostingController(rootView: card)
            addChild(controller)
            controller.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(controller.view)
            NSLayoutConstraint.activate([
                controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                controller.view.topAnchor.constraint(equalTo: view.topAnchor),
                controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
            controller.didMove(toParent: self)
            host = controller
        }
        updateSize()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateSize()
    }
    private func updateSize() {
        guard let host else { return }
        let size = host.sizeThatFits(in: CGSize(width: max(280, view.bounds.width), height: 400))
        if abs(preferredContentSize.height - size.height) > 1 { preferredContentSize = size }
    }
}
