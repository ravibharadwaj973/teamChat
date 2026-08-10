"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { post } from "@/lib/api";
import { Avatar, Modal, Spinner, cx, useToast } from "@/components/ui";
import { Send, Sparkle } from "@/components/icons";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Who is in this organization?",
  "What are my open tasks?",
  "Any announcements I should know about?",
  "What events are coming up?",
];

export default function AssistantModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeOrgId, me, orgs } = useWorkspace();
  const toast = useToast();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const orgName =
    orgs.find((o) => o.organization._id === activeOrgId)?.organization.name ||
    "your workspace";

  // Fresh conversation when switching orgs
  useEffect(() => {
    setTurns([]);
  }, [activeOrgId]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy || !activeOrgId) return;
    setValue("");
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await post<{ data: { answer: string } }>(
        `/organizations/${activeOrgId}/ai/ask`,
        {
          question: q,
          history: turns.slice(-6),
        }
      );
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: res.data.answer },
      ]);
    } catch (err: any) {
      toast(err.message, "error");
      setTurns((prev) => prev.slice(0, -1));
      setValue(q);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-accent-500 to-violet-600">
            <Sparkle size={12} className="text-white" />
          </span>
          Assistant
          <span className="text-xs font-normal text-mist-600">{orgName}</span>
        </span>
      }
      width={560}
    >
      {/* conversation */}
      <div
        ref={scrollRef}
        className="mb-3 h-[46vh] space-y-3 overflow-y-auto rounded-xl border border-line bg-ink-900 p-3.5"
      >
        {turns.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-violet-600">
              <Sparkle size={20} className="text-white" />
            </span>
            <div>
              <p className="text-sm font-semibold">Ask about {orgName}</p>
              <p className="mx-auto mt-1 max-w-[320px] text-xs leading-relaxed text-mist-600">
                People, teams, tasks, events, notices, files — answers use only
                the data you&apos;re allowed to see.
              </p>
            </div>
            <div className="flex max-w-[380px] flex-wrap justify-center gap-1.5 pt-1">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-line bg-ink-800 px-3 py-1 text-[11.5px] text-mist-400 transition-colors hover:border-accent-500/50 hover:text-mist-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cx(
              "flex items-start gap-2.5",
              t.role === "user" && "flex-row-reverse"
            )}
          >
            {t.role === "assistant" ? (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-violet-600">
                <Sparkle size={12} className="text-white" />
              </span>
            ) : (
              <Avatar name={me.username} src={me.avatar} size={24} />
            )}
            <div
              className={cx(
                "max-w-[82%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                t.role === "user"
                  ? "rounded-tr-sm bg-accent-600 text-white"
                  : "rounded-tl-sm border border-line bg-ink-800 text-mist-300"
              )}
            >
              {t.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-violet-600">
              <Sparkle size={12} className="text-white" />
            </span>
            <div className="flex items-center gap-2 rounded-xl rounded-tl-sm border border-line bg-ink-800 px-3 py-2 text-[13px] text-mist-500">
              <Spinner size={12} /> thinking…
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(value);
        }}
        className="flex items-center gap-2 rounded-xl border border-line bg-ink-800 px-3 py-2 transition-colors focus-within:border-accent-500/50"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={600}
          placeholder={`Ask about ${orgName}…`}
          className="flex-1 bg-transparent text-sm text-mist-100 placeholder:text-mist-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!value.trim() || busy}
          aria-label="Ask"
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all",
            value.trim() && !busy
              ? "bg-accent-600 text-white hover:bg-accent-500"
              : "bg-ink-700 text-mist-600"
          )}
        >
          <Send size={14} />
        </button>
      </form>
      <p className="mt-1.5 text-center text-[10.5px] text-mist-600">
        AI answers can be imperfect — they use only workspace data you have
        access to.
      </p>
    </Modal>
  );
}
