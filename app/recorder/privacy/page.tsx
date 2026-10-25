export const metadata = { title: "BASH Video Recorder Privacy" }
export default function RecorderPrivacy() {
  return <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-10 text-sm leading-7">
    <h1 className="text-2xl font-bold">BASH Video Recorder privacy policy</h1>
    <p>Updated October 24, 2026. This policy covers the BASH Video Recorder iPhone app and its recording services, operated by Raffi Hotter for Bay Area Street Hockey.</p>
    <h2 className="text-lg font-semibold">What the app collects</h2>
    <p>When you start recording, the app captures video and microphone audio. It stores clips on your phone and uploads them to BASH. A live feed is also sent while streaming is connected. Recordings can include identifiable players, spectators, voices, and anything visible or audible near the camera.</p>
    <p>The service stores recording timestamps, camera side, session and clip identifiers, upload status, device name, battery level, and recording or connection errors. Network providers may process IP addresses and technical request logs to operate and protect the service. The app does not request your location, contacts, or photo library.</p>
    <h2 className="text-lg font-semibold">How information is used and shared</h2>
    <p>We use this information to record games, deliver live streams and replays, match footage to game events, and diagnose recording or upload failures. Cloudflare processes video through R2 storage and Stream; Vercel hosts the service and Neon stores recording metadata. Authorized league operators can access recordings. Footage associated with a game may be shown publicly on BASH game pages.</p>
    <p>The native app does not include advertising or cross-app tracking. We do not sell recording data or use it for targeted advertising.</p>
    <h2 className="text-lg font-semibold">Storage and your choices</h2>
    <p>Uploaded game footage is retained indefinitely as a league archive unless removed. The app deletes each local clip after the server verifies its upload. Clips that have not been verified remain on your phone so the upload can be retried. You can stop recording at any time and revoke camera or microphone permission in iOS Settings. Uploads may continue in the background; camera recording requires the app to remain open.</p>
    <p>Only record where you have permission, and notify participants that footage may be streamed or published. To request access, correction, or removal of footage or recording metadata, contact <a className="underline" href="mailto:raphael.hotter@gmail.com">raphael.hotter@gmail.com</a> with the recording date and relevant details. Do not include your recording PIN. We will review requests and any applicable retention obligations.</p>
    <h2 className="text-lg font-semibold">Contact</h2>
    <p>For privacy questions, email <a className="underline" href="mailto:raphael.hotter@gmail.com">raphael.hotter@gmail.com</a>.</p>
  </main>
}
