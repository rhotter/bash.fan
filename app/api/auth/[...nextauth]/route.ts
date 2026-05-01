export { GET, POST } from "@/auth-handlers"
// Force the route to be dynamic / Node.js runtime — bcryptjs and the Drizzle
// adapter need full Node, not edge.
export const runtime = "nodejs"
