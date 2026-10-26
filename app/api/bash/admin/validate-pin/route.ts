// Backward-compatible URL for older scorekeeper web clients. It issues a
// role-scoped session; a scorekeeper PIN can never become an admin session.
export { POST } from "@/app/api/bash/scorekeeper/login/route"
