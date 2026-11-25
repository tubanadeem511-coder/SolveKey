import type { Metadata } from "next";
import Link from "next/link";
import { AuthPageFrame } from "../../../components/AuthPageFrame";
import { LoginForm } from "../../../components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to SolveKey — the modern civic problem resolution platform.",
};

export default function LoginPage() {
  return (
    <AuthPageFrame
      eyebrow="Civic portal"
      meta="Secure access"
      title="Welcome back"
      description="Sign in to follow civic reports, municipal responses, and the services connected to your neighborhood."
      footer={(
        <p className="mt-7 text-center text-sm text-slate-600 dark:text-slate-400">
          New to SolveKey?{" "}
          <Link href="/register" className="font-semibold text-[#012667] underline decoration-[#05D7E5] decoration-2 underline-offset-2 hover:text-[#0241A3] dark:text-[#A9E9EC]">
            Create a citizen account
          </Link>
        </p>
      )}
    >
      <LoginForm />
    </AuthPageFrame>
  );
}
