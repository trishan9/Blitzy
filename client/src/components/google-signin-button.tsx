import { useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE = (import.meta.env.VITE_BASE_API_URL ?? "http://localhost:8000/api/").replace(/\/$/, "");

export const GoogleSignInButton = ({ label = "Continue with Google" }: { label?: string }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/sign-in/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: "google",
          callbackURL: window.location.origin,
          errorCallbackURL: `${window.location.origin}/?oauth=failed`,
        }),
      });

      if (!res.ok) {
        setError("Google sign-in is not configured yet.");
        setLoading(false);
        return;
      }

      const data = (await res.json()) as { url?: string; redirect?: boolean };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Could not start Google sign-in.");
        setLoading(false);
      }
    } catch {
      setError("Could not reach the server.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={signIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
        </svg>
        {loading ? "Redirecting…" : label}
      </Button>
      {error && <p className="text-xs text-center text-destructive">{error}</p>}
    </div>
  );
};
