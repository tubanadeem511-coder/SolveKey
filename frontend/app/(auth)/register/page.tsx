import type { Metadata } from "next";
import Link from "next/link";
import { AuthPageFrame } from "../../../components/AuthPageFrame";
import { RegisterForm } from "../../../components/RegisterForm";

export const metadata: Metadata = {
  title: "Create citizen account",
  description: "Join SolveKey — report civic issues, follow solutions, and improve your neighborhood.",
};

export default function RegisterPage() {
  return (
    <AuthPageFrame
      eyebrow="Community network"
      meta="Citizen registration"
      title="Join your city in making progress"
      description="Create an account to report local issues, follow their progress, and connect with the teams working on solutions."
      footer={(
        <p className="mt-7 text-center text-sm text-slate-600 dark:text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-[#012667] underline decoration-[#05D7E5] decoration-2 underline-offset-2 hover:text-[#0241A3] dark:text-[#A9E9EC]">
            Sign in
          </Link>
        </p>
      )}
    >
      <RegisterForm />
    </AuthPageFrame>
  );
}
