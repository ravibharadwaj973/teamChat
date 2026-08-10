"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";
import { FullPageLoader } from "@/components/ui";

// Entry point: route to login, onboarding, or the workspace.
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    get<{ count: number }>("/organizations")
      .then((res) => router.replace(res.count > 0 ? "/app" : "/onboarding"))
      .catch(() => router.replace("/login"));
  }, [user, loading, router]);

  return <FullPageLoader label="Loading TeamSpace…" />;
}
