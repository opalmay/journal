import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { keys, useMe } from "../lib/queries.js";
import { Button, ErrorNote, Spinner } from "../components/ui.js";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data, isPending } = useMe();
  // Set by the OAuth consent page, which is served by the API, not this app.
  const next = useSearchParams()[0].get("next");
  const oauthNext = next?.startsWith("/oauth/") ? next : null;

  if (isPending) return <Spinner label="Checking session" />;
  if (data?.authenticated) {
    if (oauthNext) {
      window.location.replace(oauthNext);
      return <Spinner label="Continuing" />;
    }
    return <Navigate to="/" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      if (oauthNext) {
        window.location.replace(oauthNext);
        return;
      }
      await client.invalidateQueries({ queryKey: keys.me });
      void navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <div>
        <h1 className="text-lg font-semibold text-mauve">journal</h1>
        <p className="text-sm text-overlay1">A private record of days.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="rounded-lg border border-surface1 bg-mantle px-3 py-2 text-sm text-text outline-none focus:border-mauve"
        />
        <ErrorNote error={error} />
        {data && !data.configured && (
          <p className="text-xs text-yellow">
            No password is set yet. Run <code className="font-mono">npm run hash-password -- '…'</code>{" "}
            and put the result in <code className="font-mono">AUTH_PASSWORD_HASH</code>.
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
