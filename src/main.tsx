import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import { App } from "./app/App";
import "./app/styles.css";

try {
  if (localStorage.getItem("gmc-tax:theme") === "dark") document.documentElement.classList.add("dark");
} catch {
  /* storage unavailable: stay light */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
