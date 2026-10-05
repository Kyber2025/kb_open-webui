import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  PASSWORD_MIN,
  RESEND_FALLBACK_SEC,
  codeDigits,
  isEmail,
  verifyProblem,
} from "../lib/auth-form";
import type { User } from "../lib/types";
import { ErrorPanel, Modal, messageOf, useNotify } from "./UI";

type Mode = "signin" | "signup" | "reset";
const TITLES: Record<Mode, string> = {
  signin: "Welcome to Kividas",
  signup: "Create your account",
  reset: "Reset your password",
};

/**
 * Sign in, plus email-code sign-up and password reset — the same two-step flow
 * as ai.kividas.com: send a 6-digit code, then enter it with the password. The
 * last two only appear when the backend relays them to the account service
 * (`enable_kyber_auth_bridge`); without it its endpoints refuse them.
 */
export function Login({
  accountService,
  onClose,
  onSuccess,
}: {
  accountService: boolean;
  onClose: () => void;
  onSuccess: (u: User) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("signin"),
    [step, setStep] = useState<"email" | "verify">("email"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [cooldown, setCooldown] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const notify = useNotify();
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);
  // Switching forms keeps the email and drops everything secret.
  const go = (next: Mode) => {
    setMode(next);
    setStep("email");
    setCode("");
    setPassword("");
    setConfirm("");
    setError("");
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendCode() {
    const address = email.trim();
    if (!isEmail(address)) {
      setError("Enter a valid email address.");
      return;
    }
    await run(async () => {
      const sent =
        mode === "reset"
          ? await api.forgotPassword(address)
          : await api.sendRegisterCode(address);
      setEmail(address);
      setStep("verify");
      setCooldown(sent?.cooldown_sec || RESEND_FALLBACK_SEC);
    });
  }
  async function submitCode() {
    const problem = verifyProblem({ code, password, confirm });
    if (problem) {
      setError(problem);
      return;
    }
    await run(async () => {
      if (mode === "reset") {
        await api.resetPassword(email, code, password);
        notify("Password updated. Sign in with your new password.");
        go("signin");
        return;
      }
      const session = await api.registerVerify({
        email,
        code,
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      localStorage.setItem("token", session.token);
      await onSuccess(await api.me());
    });
  }
  const switchLink = (text: string, label: string, next: Mode) => (
    <p className="muted auth-switch">
      {text}{" "}
      <button type="button" className="text-btn" onClick={() => go(next)}>
        {label}
      </button>
    </p>
  );

  if (mode === "signin")
    return (
      <Modal title={TITLES.signin} onClose={onClose}>
        <p className="muted">Sign in with your existing Kividas account.</p>
        <form
          key="signin"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const session = await api.login(email, password);
              localStorage.setItem("token", session.token);
              await onSuccess(await api.me());
            });
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {accountService && (
            <div className="auth-aside">
              <button
                type="button"
                className="text-btn"
                onClick={() => go("reset")}
              >
                Forgot password?
              </button>
            </div>
          )}
          {error && <ErrorPanel error={error} />}
          <button className="btn primary full-width" disabled={busy}>
            {busy ? "Signing in…" : "Continue"}
          </button>
        </form>
        {accountService &&
          switchLink("Don't have an account?", "Sign up", "signup")}
      </Modal>
    );

  const reset = mode === "reset";
  const back = reset
    ? switchLink("Remembered it?", "Back to sign in", "signin")
    : switchLink("Already have an account?", "Sign in", "signin");
  if (step === "email")
    return (
      <Modal title={TITLES[mode]} onClose={onClose}>
        <p className="muted">
          {reset
            ? "Enter the email you signed up with. We'll send a 6-digit code to reset your password."
            : "We'll send a 6-digit code to this email. It is valid for 10 minutes."}
        </p>
        <form
          key={`${mode}-email`}
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <ErrorPanel error={error} />}
          <button className="btn primary full-width" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
        {back}
      </Modal>
    );

  return (
    <Modal title={TITLES[mode]} onClose={onClose}>
      <p className="muted">
        {reset
          ? `If ${email} has an account, a 6-digit code is on its way.`
          : `Code sent to ${email}.`}{" "}
        Check your inbox and spam folder.
      </p>
      <form
        key={`${mode}-verify`}
        onSubmit={(e) => {
          e.preventDefault();
          void submitCode();
        }}
      >
        <label>
          Verification code
          <input
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(codeDigits(e.target.value))}
          />
        </label>
        <div className="auth-aside">
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
          <button
            type="button"
            className="text-btn"
            disabled={busy || cooldown > 0}
            onClick={() => void sendCode()}
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </button>
        </div>
        {!reset && (
          <label>
            Name (optional)
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label>
          {reset ? "New password" : "Password"}
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {reset ? "Confirm new password" : "Confirm password"}
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <ErrorPanel error={error} />}
        <button className="btn primary full-width" disabled={busy}>
          {busy
            ? reset
              ? "Updating…"
              : "Creating account…"
            : reset
              ? "Reset password"
              : "Create account"}
        </button>
      </form>
      {back}
    </Modal>
  );
}
