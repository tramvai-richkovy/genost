import { Moon, Sun } from "lucide-react";
import { useStudioStore } from "../app/store";

export function ThemeToggle() {
  const theme = useStudioStore((state) => state.theme);
  const toggleTheme = useStudioStore((state) => state.toggleTheme);
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      className="icon-button"
      onClick={toggleTheme}
      title={theme === "dark" ? "Use light theme" : "Use dark theme"}
      type="button"
    >
      <Icon size={18} />
    </button>
  );
}
