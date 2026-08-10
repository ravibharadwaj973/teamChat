"use client";
import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";
import { Button, Field, Input, useToast, FullPageLoader } from "@/components/ui";
import { Hash, Megaphone, Sparkle, Users } from "@/components/icons";

function LoginInner() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const afterAuth = async () => {
    if (next) {
      router.replace(next);
      return;
    }
    try {
      const orgs = await get<{ count: number }>("/organizations");
      router.replace(orgs.count > 0 ? "/app" : "/onboarding");
    } catch {
      router.replace("/onboarding");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(username.trim(), email.trim(), password);
      await afterAuth();
    } catch (err: any) {
      toast(err.message || "Something went wrong", "error");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-ink-900 p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(600px 420px at 20% 0%, rgb(99 102 241 / 0.22), transparent 60%), radial-gradient(500px 400px at 90% 100%, rgb(139 92 246 / 0.14), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-violet-600 shadow-lg shadow-accent-600/30">
            <Sparkle size={18} className="text-white" />
          </span>
          <span className="text-lg font-semibold tracking-tight">TeamSpace</span>
        </div>

        <div className="relative space-y-6">
          <h1 className="max-w-md text-4xl font-semibold leading-[1.15] tracking-tight">
            Where your company
            <span className="bg-gradient-to-r from-accent-300 to-violet-300 bg-clip-text text-transparent">
              {" "}
              works together.
            </span>
          </h1>
          <p className="max-w-sm text-[15px] leading-relaxed text-mist-500">
            Departments, teams and channels — organized the way your org chart
            actually looks. Announcements, mentions and real-time chat included.
          </p>

          <div className="space-y-2.5 pt-2">
            {[
              { icon: <Users size={15} />, text: "Engineering · Backend Team", sub: "8 members · 3 channels" },
              { icon: <Hash size={15} />, text: "#standup", sub: "sarah: shipping the org switcher today 🚀" },
              { icon: <Megaphone size={15} />, text: "#announcements", sub: "All-hands moved to Thursday 3pm" },
            ].map((c, i) => (
              <div
                key={i}
                className="flex w-fit min-w-[300px] items-center gap-3 rounded-xl border border-line bg-ink-800/80 px-4 py-3 backdrop-blur"
                style={{ marginLeft: i * 22 }}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-700 text-accent-300">
                  {c.icon}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-mist-100">{c.text}</p>
                  <p className="text-xs text-mist-600">{c.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-mist-600">
          Built for teams of 2 to 2,000.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-ink-950 px-6">
        <div className="w-full max-w-[380px] animate-fade-up">
          <div className="mb-8 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-violet-600">
              <Sparkle size={18} className="text-white" />
            </span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className="mt-1 text-sm text-mist-500">
            {mode === "login"
              ? "Sign in to your workspace."
              : "Then create or join an organization."}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === "register" && (
              <Field label="Username">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="sarah.chen"
                  minLength={3}
                  maxLength={20}
                  required
                  autoFocus
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus={mode === "login"}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
            </Field>
            <Button type="submit" loading={busy} className="w-full py-2.5">
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-mist-500">
            {mode === "login" ? "New to TeamSpace?" : "Already have an account?"}{" "}
            <button
              className="font-medium text-accent-300 hover:text-accent-400"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <LoginInner />
    </Suspense>
  );
}
