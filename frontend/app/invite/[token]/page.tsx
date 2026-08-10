"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { InviteInfo } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/format";
import {
  Avatar,
  Badge,
  Button,
  FullPageLoader,
  useToast,
} from "@/components/ui";
import { Mail, Sparkle } from "@/components/icons";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading } = useAuth();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    get<{ data: InviteInfo }>(`/invites/${token}`)
      .then((res) => setInvite(res.data))
      .catch((err) => setError(err.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    try {
      const res = await post<{ data: { organization: { _id: string } } }>(
        `/invites/${token}/accept`
      );
      localStorage.setItem("ts.activeOrg", res.data.organization._id);
      toast(`Welcome to ${invite?.organization.name}!`);
      router.replace("/app");
    } catch (err: any) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await post(`/invites/${token}/decline`);
      toast("Invite declined");
      router.replace("/");
    } catch (err: any) {
      toast(err.message, "error");
      setBusy(false);
    }
  };

  if (loading || (!invite && !error)) return <FullPageLoader />;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink-950 px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(700px 420px at 50% -10%, rgb(99 102 241 / 0.16), transparent 60%)",
        }}
      />
      <div className="relative w-full max-w-[420px] animate-fade-up">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-violet-600">
            <Sparkle size={17} className="text-white" />
          </span>
          <span className="font-semibold tracking-tight">TeamSpace</span>
        </div>

        <div className="rounded-2xl border border-line bg-ink-850 p-7 text-center shadow-2xl shadow-black/40">
          {error || !invite ? (
            <>
              <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-ink-750 text-danger">
                <Mail size={20} />
              </span>
              <h1 className="text-lg font-semibold">Invite unavailable</h1>
              <p className="mt-1.5 text-sm text-mist-500">
                {error || "This invite could not be loaded."}
              </p>
              <Button className="mt-6 w-full" onClick={() => router.push("/")}>
                Go to TeamSpace
              </Button>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 w-fit">
                <Avatar name={invite.organization.name} square size={52} />
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                Join {invite.organization.name}
              </h1>
              <p className="mx-auto mt-1.5 max-w-[300px] text-sm leading-relaxed text-mist-500">
                {invite.invitedBy?.username || "An admin"} invited{" "}
                <span className="text-mist-300">{invite.email}</span> to join as{" "}
                <Badge className="ml-0.5 align-middle border-accent-500/30 bg-accent-500/10 text-accent-300">
                  {ROLE_LABEL[invite.role]}
                </Badge>
              </p>
              {invite.message && (
                <p className="mx-auto mt-4 max-w-[300px] rounded-lg border border-line bg-ink-800 px-3 py-2 text-[13px] italic text-mist-300">
                  “{invite.message}”
                </p>
              )}

              {invite.status !== "pending" ? (
                <p className="mt-6 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn">
                  This invite is {invite.status}.
                </p>
              ) : user ? (
                <div className="mt-6 space-y-2.5">
                  <Button loading={busy} className="w-full py-2.5" onClick={accept}>
                    Accept invitation
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    className="w-full"
                    onClick={decline}
                  >
                    Decline
                  </Button>
                  <p className="pt-1 text-xs text-mist-600">
                    Signed in as {user.username} — the invite email must match
                    your account.
                  </p>
                </div>
              ) : (
                <div className="mt-6 space-y-2.5">
                  <Button
                    className="w-full py-2.5"
                    onClick={() =>
                      router.push(`/login?next=/invite/${token}`)
                    }
                  >
                    Sign in to accept
                  </Button>
                  <p className="text-xs text-mist-600">
                    No account yet? Register with {invite.email} first.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
