import Link from "next/link"
export const metadata = { title: "BASH Video Recorder Support" }
export default function RecorderSupport() {
  return <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-10 text-sm leading-7">
    <h1 className="text-2xl font-bold">BASH Video Recorder support</h1>
    <p>Record and upload Bay Area Street Hockey games with your iPhone. League camera operators receive a recording PIN from the league organizer.</p>
    <h2 className="text-lg font-semibold">Getting started</h2>
    <p>Tap Set up recording, enter your PIN, and choose the left or right camera position. Open the camera, mount your iPhone in landscape with the volume buttons facing up, and start recording. You need a rear 0.5× ultra-wide camera that supports 4K at 60 fps, camera and microphone permission, and enough free storage.</p>
    <h2 className="text-lg font-semibold">Recording and uploads</h2>
    <p>Keep the app open to record. Streaming needs an internet connection; if it fails, local recording continues. Saved clips upload automatically and are removed from your phone only after verification. Uploads can continue in the background. If you force-quit the app, reopen it to resume uploads. Connect to reliable Wi-Fi and power for long games.</p>
    <h2 className="text-lg font-semibold">Need help?</h2>
    <p>Email <a className="underline" href="mailto:raphael.hotter@gmail.com">raphael.hotter@gmail.com</a> with your iPhone model, iOS version, recording date, and the error you see. Never send your PIN.</p>
    <Link className="underline" href="/recorder/privacy">Privacy policy</Link>
  </main>
}
