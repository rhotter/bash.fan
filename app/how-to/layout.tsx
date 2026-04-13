import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "How-To Guides",
    description: "BASH how-to guides — assembling the boards and packing the shed.",
}

export default function HowToLayout({ children }: { children: React.ReactNode }) {
    return children
}
