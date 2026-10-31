import UserNotifications
import UIKit

// Local bundled artwork avoids delaying delivery on an image download.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
              let slug = content.userInfo["teamSlug"] as? String,
              let asset = SportsTeam.asset(slug), let image = UIImage(named: asset) else {
            contentHandler(request.content); return
        }
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent("team.png")
            let thumbnail = UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128)).image { _ in
                let scale = min(112 / image.size.width, 112 / image.size.height)
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: (128 - size.width) / 2, y: (128 - size.height) / 2, width: size.width, height: size.height))
            }
            if let data = thumbnail.pngData() {
                try data.write(to: url)
                content.attachments = [try UNNotificationAttachment(identifier: "team", url: url)]
            }
        } catch { /* Always deliver the text when an attachment cannot be created. */ }
        contentHandler(content)
    }
}
