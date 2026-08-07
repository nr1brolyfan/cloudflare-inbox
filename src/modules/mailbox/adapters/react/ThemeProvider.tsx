import { Laptop, Moon, Sun } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export type Theme = "dark" | "light" | "system";

const themeStorageKey = "cloudflare-inbox-theme";
const ThemeContext = createContext<Theme>("system");
const SetThemeContext = createContext<(theme: Theme) => void>(() => false);
const themeListeners = new Set<() => void>();

const isTheme = (value: string | null): value is Theme =>
  value === "dark" || value === "light" || value === "system";

const getTheme = (): Theme => {
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  return isTheme(savedTheme) ? savedTheme : "system";
};

const subscribeToTheme = (listener: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === themeStorageKey) {
      listener();
    }
  };
  themeListeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
};

const setThemePreference = (theme: Theme) => {
  window.localStorage.setItem(themeStorageKey, theme);
  for (const listener of themeListeners) {
    listener();
  }
};

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const theme = useSyncExternalStore<Theme>(
    subscribeToTheme,
    getTheme,
    () => "system"
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches)
      );
      document.documentElement.style.colorScheme =
        theme === "system" ? "light dark" : theme;
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  return (
    <SetThemeContext value={setThemePreference}>
      <ThemeContext value={theme}>{children}</ThemeContext>
    </SetThemeContext>
  );
}

const themes = [
  { icon: Sun, label: "Light theme", value: "light" },
  { icon: Moon, label: "Dark theme", value: "dark" },
  { icon: Laptop, label: "System theme", value: "system" },
] as const;

export function ThemeToggle() {
  const theme = useContext(ThemeContext);
  const setTheme = useContext(SetThemeContext);

  return (
    <fieldset
      aria-label="Color theme"
      className="flex shrink-0 items-center rounded-xl border border-[var(--line)] bg-[var(--control-bg)] p-1"
    >
      {themes.map(({ icon: Icon, label, value }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={`flex size-6 items-center justify-center rounded-lg min-[360px]:size-7 ${
            theme === value
              ? "bg-[var(--surface-strong)] text-[var(--sea-ink)] shadow-sm"
              : "text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
          }`}
        >
          <Icon aria-hidden="true" size={13} />
        </Button>
      ))}
    </fieldset>
  );
}
