import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@tabalabs/upsure-react/styles.css";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
