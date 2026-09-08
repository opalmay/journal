import { NavLink, Outlet, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { keys } from "../lib/queries.js";

const LINKS = [
  { to: "/", label: "Timeline", end: true },
  { to: "/calendar", label: "Calendar", end: false },
  { to: "/search", label: "Search", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function Layout() {
  const navigate = useNavigate();
  const client = useQueryClient();

  const logout = async () => {
    await api.logout();
    client.clear();
    void client.invalidateQueries({ queryKey: keys.me });
    void navigate("/login");
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-surface1 bg-mantle/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3">
          <NavLink to="/" className="mr-3 text-sm font-semibold tracking-tight text-mauve">
            journal
          </NavLink>
          <nav className="flex gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  `rounded-lg px-2.5 py-1 text-sm transition-colors ${
                    isActive ? "bg-surface0 text-text" : "text-subtext0 hover:text-text"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
          <button
            onClick={() => void logout()}
            className="ml-auto text-xs text-overlay1 transition-colors hover:text-red"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
