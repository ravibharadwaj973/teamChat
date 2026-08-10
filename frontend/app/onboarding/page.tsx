"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { INDUSTRIES, ORG_SIZES } from "@/lib/types";
import { prettyIndustry } from "@/lib/format";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import { Building, Sparkle } from "@/components/icons";

export default function OnboardingPage() {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("1-10");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const { user, logout } = useAuth();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post<{ data: { organization: { _id: string } } }>(
        "/organizations",
        {
          name: name.trim(),
          industry: industry || null,
          size,
          description,
        }
      );
      localStorage.setItem("ts.activeOrg", res.data.organization._id);
      router.replace("/app");
    } catch (err: any) {
      toast(err.message || "Failed to create organization", "error");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink-950 px-6 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(700px 420px at 50% -10%, rgb(99 102 241 / 0.16), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-[460px] animate-fade-up">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-violet-600">
            <Sparkle size={17} className="text-white" />
          </span>
          <span className="font-semibold tracking-tight">TeamSpace</span>
        </div>

        <div className="rounded-2xl border border-line bg-ink-850 p-7 shadow-2xl shadow-black/40">
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-750 text-accent-300">
            <Building size={20} />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">
            Create your organization
          </h1>
          <p className="mt-1 text-sm text-mist-500">
            You&apos;ll be the owner. Invite your team right after —{" "}
            <span className="text-mist-300">{user?.username}</span>.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Organization name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                minLength={2}
                maxLength={60}
                required
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Industry">
                <Select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  <option value="">Select…</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {prettyIndustry(i)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Company size">
                <Select value={size} onChange={(e) => setSize(e.target.value)}>
                  {ORG_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} people
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Description" hint="Optional — what does your company do?">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="We build rockets."
                maxLength={500}
              />
            </Field>
            <Button type="submit" loading={busy} className="w-full py-2.5">
              Create organization
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-[13px] text-mist-600">
          Waiting for an invite? Ask your admin for the invite link ·{" "}
          <button
            className="text-mist-400 underline-offset-2 hover:text-mist-300 hover:underline"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
            sign out
          </button>
        </p>
      </div>
    </div>
  );
}
