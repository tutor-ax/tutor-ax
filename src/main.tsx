import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createDemoGateway, type SessionStorage } from "./gateway";
import "./styles/theme.css";
import "./styles/score.css";

// Lazy access handles browsers which disallow even obtaining localStorage.
const storage: SessionStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
const gateway = createDemoGateway(storage);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App gateway={gateway} />
  </StrictMode>,
);
